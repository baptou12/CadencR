//! TTL-cached snapshot of opencode's `/config/providers` response.
//!
//! Mirrors the Codex `live_catalog` pattern at
//! `domain/agents/codex/mod.rs:131`: a single in-process `RwLock` over an
//! `Option<CatalogCacheEntry>`, a separate `Mutex` for single-flight
//! refresh, and a double-check-after-lock so a thundering-herd of probes
//! collapses to one. Probe failures are folded into the cache too — see
//! `live_catalog_with`. That's load-bearing for `.claude/rules/error-
//! handling.md`: a flaky probe must not respawn `opencode acp` on every
//! FE refresh.
//!
//! The probe seam is intentional: the production path uses
//! `super::probe::run`, but inline tests inject a counting closure via
//! `live_catalog_with` to assert TTL + failure-caching behaviour without
//! actually spawning a subprocess.

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use opencode_sdk_rs::ConfigProvidersResponse;
use tokio::sync::{Mutex, RwLock};

use crate::domain::agents::adapter::RuntimeError;
use crate::domain::agents::runtime::ProviderCatalogEntry;

const CATALOG_TTL: Duration = Duration::from_secs(30);

#[derive(Clone)]
pub(super) struct CatalogCacheEntry {
    pub(super) fetched_at: Instant,
    pub(super) catalog: ProviderCatalogEntry,
    pub(super) context_windows: Arc<HashMap<String, u64>>,
}

static CATALOG_CACHE: OnceLock<RwLock<Option<CatalogCacheEntry>>> = OnceLock::new();
static CATALOG_REFRESH_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn catalog_cache() -> &'static RwLock<Option<CatalogCacheEntry>> {
    CATALOG_CACHE.get_or_init(|| RwLock::new(None))
}

fn catalog_refresh_lock() -> &'static Mutex<()> {
    CATALOG_REFRESH_LOCK.get_or_init(|| Mutex::new(()))
}

/// Public production entry point: returns just the catalog half, using
/// the real subprocess probe.
pub(super) async fn live_catalog() -> ProviderCatalogEntry {
    live_catalog_with(super::probe::run).await
}

/// Same as `live_catalog`, but returns the full cache entry so callers
/// who need the `context_windows` lookup table (e.g.
/// `context_window_for_model`) can read it without re-shaping the
/// catalog.
pub(super) async fn live_catalog_entry() -> CatalogCacheEntry {
    live_catalog_entry_with(super::probe::run).await
}

/// Probe seam. Pure function over `probe()`; lets tests inject a
/// counting closure that returns `Ok`/`Err` deterministically without
/// spawning a subprocess.
pub(super) async fn live_catalog_with<F, Fut>(probe: F) -> ProviderCatalogEntry
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<ConfigProvidersResponse, RuntimeError>>,
{
    live_catalog_entry_with(probe).await.catalog
}

async fn live_catalog_entry_with<F, Fut>(probe: F) -> CatalogCacheEntry
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<ConfigProvidersResponse, RuntimeError>>,
{
    if let Some(entry) = catalog_cache().read().await.clone() {
        if entry.fetched_at.elapsed() < CATALOG_TTL {
            return entry;
        }
    }

    let _refresh = catalog_refresh_lock().lock().await;
    if let Some(entry) = catalog_cache().read().await.clone() {
        if entry.fetched_at.elapsed() < CATALOG_TTL {
            return entry;
        }
    }

    let entry = match probe().await {
        Ok(response) => entry_from_response(response),
        Err(error) => {
            // Per `.claude/rules/error-handling.md`: surface the failure
            // to logs, but still cache the static fallback for the TTL
            // window so we don't respawn `opencode acp` on every FE
            // refresh.
            tracing::warn!(
                provider = "opencode",
                error = %error,
                "live catalog probe failed; using static fallback",
            );
            fallback_entry()
        }
    };

    *catalog_cache().write().await = Some(entry.clone());
    entry
}

fn entry_from_response(response: ConfigProvidersResponse) -> CatalogCacheEntry {
    let (catalog, context_windows) = super::catalog_from_response(response);
    CatalogCacheEntry {
        fetched_at: Instant::now(),
        catalog,
        context_windows: Arc::new(context_windows),
    }
}

fn fallback_entry() -> CatalogCacheEntry {
    CatalogCacheEntry {
        fetched_at: Instant::now(),
        catalog: super::catalog_entry(),
        context_windows: Arc::new(HashMap::new()),
    }
}

#[cfg(test)]
pub(super) async fn reset_for_test() {
    *catalog_cache().write().await = None;
}

#[cfg(test)]
pub(super) async fn force_expire_for_test() {
    let mut guard = catalog_cache().write().await;
    if let Some(entry) = guard.as_mut() {
        entry.fetched_at = Instant::now() - CATALOG_TTL - Duration::from_secs(1);
    }
}

/// Shared serializer for tests across this module *and* `super::tests`.
/// Both touch the same process-global cache, so they must run one at a
/// time even though they live in different `cfg(test)` mods.
#[cfg(test)]
pub(super) static TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn sample_response() -> ConfigProvidersResponse {
        serde_json::from_value(serde_json::json!({
            "providers": [
                {
                    "id": "anthropic",
                    "name": "Anthropic",
                    "models": {
                        "claude-sonnet-4-5": {
                            "name": "Claude Sonnet 4.5",
                            "limit": { "context": 200000, "output": 64000 }
                        }
                    }
                }
            ],
            "default": { "anthropic": "claude-sonnet-4-5" }
        }))
        .expect("fixture parses")
    }

    #[tokio::test]
    async fn cache_returns_stale_entry_within_ttl() {
        let _guard = TEST_LOCK.lock().await;
        reset_for_test().await;
        let calls = AtomicUsize::new(0);
        let probe = || {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Ok(sample_response()) }
        };

        let first = live_catalog_with(&probe).await;
        let second = live_catalog_with(&probe).await;
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(first.default_model, second.default_model);
        reset_for_test().await;
    }

    #[tokio::test]
    async fn cache_refreshes_after_ttl() {
        let _guard = TEST_LOCK.lock().await;
        reset_for_test().await;
        let calls = AtomicUsize::new(0);
        let probe = || {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Ok(sample_response()) }
        };

        let _ = live_catalog_with(&probe).await;
        force_expire_for_test().await;
        let _ = live_catalog_with(&probe).await;
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        reset_for_test().await;
    }

    #[tokio::test]
    async fn probe_failure_falls_back_to_static_catalog() {
        let _guard = TEST_LOCK.lock().await;
        reset_for_test().await;
        let calls = AtomicUsize::new(0);
        let probe = || {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Err(RuntimeError::new("probe boom")) }
        };

        let fallback = super::super::catalog_entry();
        let first = live_catalog_with(&probe).await;
        assert_eq!(first.id, fallback.id);
        assert_eq!(first.default_model, fallback.default_model);
        assert_eq!(first.models.len(), fallback.models.len());

        // Subsequent call within TTL must not re-spawn the probe.
        let _ = live_catalog_with(&probe).await;
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        reset_for_test().await;
    }
}
