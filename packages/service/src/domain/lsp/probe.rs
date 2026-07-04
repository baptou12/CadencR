//! Read-only inspection of the LSP catalog for the settings UI.
//!
//! Mirrors a subset of [`super::spawn::resolve_server`] but never spawns the
//! downloader. The renderer calls `GET /api/lsp/servers` on the settings
//! page to render an "installed language servers" list — that view must not
//! kick off a 30 MB GitHub fetch as a side-effect of being opened.
//!
//! Provider-neutral: the route returns a list keyed by `lsp_id`, never a
//! map branched on language name. Per `provider-boundaries.md`.

use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::sync::{Mutex, RwLock};
use utoipa::ToSchema;

use super::catalog::{self, CatalogEntry, ServerRole};
use super::downloader;

/// One catalog row's installation state.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ServerProbe {
    /// Stable id (`typescript-language-server`, `rust-analyzer`, …).
    pub lsp_id: String,
    /// Bare binary name searched on `$PATH`.
    pub bin_name: String,
    /// All LSP `languageId`s served by this entry.
    pub language_ids: Vec<String>,
    /// The role this server fills (type checker, linter, …). Lets the renderer
    /// build the per-file active-server set from this catalog data instead of
    /// duplicating the catalog client-side.
    pub role: ServerRole,
    /// Where the binary was found, or `missing` if not installed.
    pub status: ServerProbeStatus,
    /// Absolute path on disk when found. `None` otherwise.
    pub path: Option<String>,
    /// Version string when reported by the binary itself (or pinned by the
    /// downloader recipe for managed installs). `None` if unknown.
    pub version: Option<String>,
    /// `true` iff the catalog has a downloader recipe — i.e. opening a file
    /// in this language would trigger an automatic install.
    pub downloadable: bool,
}

#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ServerProbeStatus {
    /// Found on `$PATH` or in well-known dirs (cli-discovery).
    OnPath,
    /// Found at the managed install location
    /// `~/.cadencr/lsp/<lsp_id>/<version>/<bin_name>`.
    Managed,
    /// Not installed.
    Missing,
}

/// TTL for the cached probe snapshot. Installed LSP binaries change rarely,
/// but the settings page — and every `settings_event`-driven refetch — hits
/// `GET /api/lsp/servers`, and each uncached probe re-runs `cli-discovery`
/// (a login-shell PATH resolve + a `--version` spawn per catalog entry). On a
/// hot machine those subprocess spawns stack up and jank the UI, so we fold
/// the whole snapshot into a short-lived cache. Mirrors the provider-catalog
/// TTL pattern in `domain/agents/providers/opencode/cache.rs`.
const PROBE_TTL: Duration = Duration::from_secs(30);

static PROBE_CACHE: OnceLock<RwLock<Option<(Instant, Arc<Vec<ServerProbe>>)>>> = OnceLock::new();
static PROBE_REFRESH_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn probe_cache() -> &'static RwLock<Option<(Instant, Arc<Vec<ServerProbe>>)>> {
    PROBE_CACHE.get_or_init(|| RwLock::new(None))
}

fn probe_refresh_lock() -> &'static Mutex<()> {
    PROBE_REFRESH_LOCK.get_or_init(|| Mutex::new(()))
}

/// Probe every catalog entry, served from a 30s TTL cache. On a cache miss the
/// probes run in parallel — each does at most one directory walk + one
/// `--version` invocation — behind a double-checked refresh lock so concurrent
/// callers share a single probe pass instead of stampeding subprocess spawns.
pub async fn probe_servers() -> Arc<Vec<ServerProbe>> {
    if let Some((fetched_at, snapshot)) = probe_cache().read().await.clone() {
        if fetched_at.elapsed() < PROBE_TTL {
            return snapshot;
        }
    }

    let _guard = probe_refresh_lock().lock().await;
    if let Some((fetched_at, snapshot)) = probe_cache().read().await.clone() {
        if fetched_at.elapsed() < PROBE_TTL {
            return snapshot;
        }
    }

    let futures = catalog::CATALOG.iter().map(probe_entry);
    let snapshot = Arc::new(futures::future::join_all(futures).await);
    *probe_cache().write().await = Some((Instant::now(), Arc::clone(&snapshot)));
    snapshot
}

async fn probe_entry(entry: &CatalogEntry) -> ServerProbe {
    let downloadable = entry.download.is_some();
    let base = ServerProbe {
        lsp_id: entry.lsp_id.to_string(),
        bin_name: entry.bin_name.to_string(),
        language_ids: entry.language_ids.iter().map(|s| s.to_string()).collect(),
        role: entry.role,
        status: ServerProbeStatus::Missing,
        path: None,
        version: None,
        downloadable,
    };

    // First: cli-discovery. Picks up `$PATH`, login-shell PATH, and the
    // catalog's `well_known_*` dirs.
    let spec = entry.discovery_spec();
    let candidates = cli_discovery::discover_all(&spec, None).await;
    if let Some(best) = cli_discovery::select_best(&candidates) {
        return ServerProbe {
            status: ServerProbeStatus::OnPath,
            path: Some(best.canonical.to_string_lossy().into_owned()),
            version: best.version.as_ref().map(|v| v.to_string_dotted()),
            ..base
        };
    }

    // Second: managed install on disk. We deliberately do NOT invoke the
    // downloader here — the settings page should never trigger a network
    // fetch by being opened. If the user wants the binary installed, opening
    // a file in that language hits `resolve_server` which downloads.
    if let Some(recipe) = &entry.download {
        if let Ok(bin) = downloader::managed_bin_path(entry, recipe) {
            if bin.exists() {
                return ServerProbe {
                    status: ServerProbeStatus::Managed,
                    path: Some(bin.to_string_lossy().into_owned()),
                    version: Some(recipe.version().to_string()),
                    ..base
                };
            }
        }
    }

    base
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn probe_snapshot_is_ttl_cached() {
        // Two probes within the TTL must return the same cached snapshot
        // (pointer-equal Arc) — this is what keeps a settings-page refetch
        // storm from re-spawning `--version` for every LSP binary.
        let first = probe_servers().await;
        let second = probe_servers().await;
        assert!(
            Arc::ptr_eq(&first, &second),
            "second probe within TTL should reuse the cached snapshot",
        );
    }

    #[tokio::test]
    async fn probe_returns_one_entry_per_catalog_row() {
        let probes = probe_servers().await;
        assert_eq!(probes.len(), catalog::CATALOG.len());
        // Every catalog entry must appear exactly once.
        for entry in catalog::CATALOG {
            let matches = probes.iter().filter(|p| p.lsp_id == entry.lsp_id).count();
            assert_eq!(matches, 1, "lsp_id {} appears {matches}x", entry.lsp_id);
        }
    }

    #[tokio::test]
    async fn probe_exposes_language_ids_verbatim() {
        let probes = probe_servers().await;
        let ts = probes
            .iter()
            .find(|p| p.lsp_id == "typescript-language-server")
            .expect("ts entry");
        assert!(ts.language_ids.contains(&"typescript".to_string()));
        assert!(ts.language_ids.contains(&"typescriptreact".to_string()));
    }

    #[tokio::test]
    async fn probe_flags_downloadable_entries() {
        let probes = probe_servers().await;
        let ra = probes
            .iter()
            .find(|p| p.lsp_id == "rust-analyzer")
            .expect("ra entry");
        // rust-analyzer has a GithubReleaseGz recipe — must surface as
        // downloadable regardless of whether the binary is on this host.
        assert!(ra.downloadable);
        let ts = probes
            .iter()
            .find(|p| p.lsp_id == "typescript-language-server")
            .expect("ts entry");
        // TypeScript is an npm-managed recipe, so opening a TS/TSX file
        // should trigger the same auto-install flow as native binaries.
        assert!(ts.downloadable);
    }

    #[test]
    fn missing_status_serializes_in_snake_case() {
        // The renderer matches on the discriminant string verbatim; renames
        // here are a breaking API change.
        let s = serde_json::to_string(&ServerProbeStatus::OnPath).unwrap();
        assert_eq!(s, "\"on_path\"");
        let s = serde_json::to_string(&ServerProbeStatus::Managed).unwrap();
        assert_eq!(s, "\"managed\"");
        let s = serde_json::to_string(&ServerProbeStatus::Missing).unwrap();
        assert_eq!(s, "\"missing\"");
    }
}
