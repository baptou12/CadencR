//! Grants: ephemeral, in-memory tokens the service mints for one tab instance
//! (`docs/CUSTOM_TABS.md` §1, §4.2).
//!
//! A grant names the plugin, project, feature and consented scopes. Only the
//! SHA-256 of the token is kept (as the map key, like device tokens in
//! `domain::remote::tokens`), nothing is persisted, and a restart revokes
//! every grant. Revocation also cancels the grant's token so a live plugin
//! socket closes at once.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;

use super::policy::Scope;
use super::registry;
use super::watcher::PluginTabChangedEvent;
use crate::domain::remote::tokens::{hash_token, mint_raw_token};

/// How long a grant lives. The broker mints a fresh one before it lapses.
pub const GRANT_TTL: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone)]
pub struct Grant {
    pub plugin_id: String,
    pub project_id: i64,
    pub feature_id: i64,
    pub scopes: Vec<Scope>,
    /// The permissions hash (scopes + allowed origins) the grant was consented
    /// and minted under. A manifest whose hash moves away from it revokes the
    /// grant, and every self route re-checks it (`plugin_routes`).
    pub permissions_hash: String,
    pub expires: Instant,
    /// SHA-256 (hex) of the token: the store key, never the token itself.
    pub key: String,
    /// Cancelled on revocation.
    pub revoked: CancellationToken,
}

impl Grant {
    pub fn has_scope(&self, scope: Scope) -> bool {
        self.scopes.contains(&scope)
    }

    fn is_live(&self, now: Instant) -> bool {
        now < self.expires && !self.revoked.is_cancelled()
    }
}

/// What a grant is minted for.
#[derive(Debug, Clone, bon::Builder)]
pub struct GrantRequest {
    pub plugin_id: String,
    pub project_id: i64,
    pub feature_id: i64,
    pub scopes: Vec<Scope>,
    pub permissions_hash: String,
    /// [`GRANT_TTL`] for a tab instance; a backend's grant lives as long as
    /// its process and is revoked when it stops.
    #[builder(default = GRANT_TTL)]
    pub ttl: Duration,
}

/// A freshly minted grant: the raw token is shown once, to the broker.
pub struct Minted {
    pub token: String,
    pub grant: Grant,
    pub expires_at: DateTime<Utc>,
}

/// The grants of this process. Cheap to clone.
#[derive(Clone, Default)]
pub struct GrantStore {
    inner: Arc<Mutex<HashMap<String, Grant>>>,
}

impl GrantStore {
    /// Mint a token for `request`; expired grants are pruned here.
    pub fn mint(&self, request: GrantRequest) -> Minted {
        let token = mint_raw_token();
        let now = Instant::now();
        let grant = Grant {
            plugin_id: request.plugin_id,
            project_id: request.project_id,
            feature_id: request.feature_id,
            scopes: request.scopes,
            permissions_hash: request.permissions_hash,
            expires: now + request.ttl,
            key: token_key(&token),
            revoked: CancellationToken::new(),
        };
        let mut grants = self.lock();
        prune(&mut grants, now);
        grants.insert(grant.key.clone(), grant.clone());
        Minted {
            token,
            grant,
            expires_at: Utc::now()
                + chrono::Duration::from_std(request.ttl).expect("the TTL fits a chrono duration"),
        }
    }

    /// The live grant for a presented token. Runs on every plugin request, so
    /// only the presented grant is checked (and dropped when expired).
    pub fn resolve(&self, token: &str) -> Option<Grant> {
        let key = token_key(token);
        let mut grants = self.lock();
        let grant = grants.get(&key)?;
        if grant.is_live(Instant::now()) {
            return Some(grant.clone());
        }
        grants.remove(&key).inspect(|grant| grant.revoked.cancel());
        None
    }

    /// Revoke the grant stored under `key` (a token hash).
    pub fn revoke_key(&self, key: &str) -> bool {
        let removed = self.lock().remove(key);
        removed.inspect(|grant| grant.revoked.cancel()).is_some()
    }

    /// Revoke every grant of `plugin_id`; returns how many were live.
    pub fn revoke_plugin(&self, plugin_id: &str) -> usize {
        self.revoke_where(|grant| grant.plugin_id == plugin_id)
    }

    /// Revoke the grants of `plugin_id` in `project_id`.
    pub fn revoke_project(&self, plugin_id: &str, project_id: i64) -> usize {
        self.revoke_where(|grant| grant.plugin_id == plugin_id && grant.project_id == project_id)
    }

    /// Revoke the grants of `plugin_id` minted under another permissions hash
    /// (or under any hash when `current` is `None`: the manifest is invalid).
    pub fn revoke_stale(&self, plugin_id: &str, current: Option<&str>) -> usize {
        self.revoke_where(|grant| {
            grant.plugin_id == plugin_id && Some(grant.permissions_hash.as_str()) != current
        })
    }

    /// Whether a live grant other than `except_key` is open for `plugin_id`
    /// in `feature_id`: some tab instance still shows it there.
    pub fn has_other_live(&self, plugin_id: &str, feature_id: i64, except_key: &str) -> bool {
        let now = Instant::now();
        self.lock().values().any(|grant| {
            grant.plugin_id == plugin_id
                && grant.feature_id == feature_id
                && grant.key != except_key
                && grant.is_live(now)
        })
    }

    /// The projects `plugin_id` holds grants in, sorted.
    pub fn projects_of(&self, plugin_id: &str) -> Vec<i64> {
        let mut projects: Vec<i64> = self
            .lock()
            .values()
            .filter(|grant| grant.plugin_id == plugin_id)
            .map(|grant| grant.project_id)
            .collect();
        projects.sort_unstable();
        projects.dedup();
        projects
    }

    fn revoke_where(&self, mut doomed: impl FnMut(&Grant) -> bool) -> usize {
        let mut grants = self.lock();
        let before = grants.len();
        grants.retain(|_, grant| {
            let revoke = doomed(grant);
            if revoke {
                grant.revoked.cancel();
            }
            !revoke
        });
        before - grants.len()
    }

    fn has_plugin(&self, plugin_id: &str) -> bool {
        self.lock()
            .values()
            .any(|grant| grant.plugin_id == plugin_id)
    }

    fn plugin_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self
            .lock()
            .values()
            .map(|grant| grant.plugin_id.clone())
            .collect();
        ids.sort();
        ids.dedup();
        ids
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.lock().len()
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, Grant>> {
        // The map stays consistent under a panic mid-operation (each
        // operation is a single insert/remove/retain), so a poisoned lock is
        // safe to keep using.
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn prune(grants: &mut HashMap<String, Grant>, now: Instant) {
    grants.retain(|_, grant| {
        let live = grant.is_live(now);
        if !live {
            grant.revoked.cancel();
        }
        live
    });
}

/// Unpeppered: grants live in memory only, so there is no stored hash to leak.
fn token_key(token: &str) -> String {
    hash_token(&[], token)
}

/// Revoke grants when the watcher reports a tab whose manifest no longer
/// matches them: widened/narrowed permissions or origins, or an invalid
/// `tab.json`. A `dist/` rebuild leaves the hash alone and keeps grants live.
pub async fn revoke_on_manifest_change(
    store: GrantStore,
    mut events: broadcast::Receiver<PluginTabChangedEvent>,
) {
    loop {
        let plugin_ids = match events.recv().await {
            Ok(event) => vec![event.plugin_id],
            // Missed events: re-check every plugin that holds a grant.
            Err(broadcast::error::RecvError::Lagged(_)) => store.plugin_ids(),
            Err(broadcast::error::RecvError::Closed) => return,
        };
        for plugin_id in plugin_ids {
            if !store.has_plugin(&plugin_id) {
                continue;
            }
            let current = match registry::get(&plugin_id).await {
                Ok(tab) => tab.require_valid().ok().map(|(_, hash)| hash),
                Err(_) => None,
            };
            let revoked = store.revoke_stale(&plugin_id, current.as_deref());
            if revoked > 0 {
                tracing::info!(
                    plugin_id,
                    revoked,
                    "custom tab manifest changed; grants revoked"
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(plugin_id: &str, hash: &str) -> GrantRequest {
        GrantRequest::builder()
            .plugin_id(plugin_id.into())
            .project_id(1)
            .feature_id(2)
            .scopes(vec![Scope::GitRead])
            .permissions_hash(hash.into())
            .build()
    }

    #[test]
    fn mints_opaque_tokens_and_stores_only_their_hash() {
        let store = GrantStore::default();
        let Minted {
            token,
            grant,
            expires_at,
        } = store.mint(request("graph", "h1"));
        assert_eq!(token.len(), 43);
        assert_ne!(grant.key, token);
        assert!(!store.lock().contains_key(&token));
        let resolved = store.resolve(&token).unwrap();
        assert_eq!((resolved.project_id, resolved.feature_id), (1, 2));
        assert!(resolved.has_scope(Scope::GitRead) && !resolved.has_scope(Scope::FilesRead));
        assert!(store.resolve("not-a-token").is_none());
        let remaining = expires_at - Utc::now();
        assert!(remaining <= chrono::Duration::minutes(15));
        assert!(remaining > chrono::Duration::minutes(14));
    }

    #[test]
    fn revocation_cancels_and_forgets() {
        let store = GrantStore::default();
        let Minted {
            token: a,
            grant: grant_a,
            ..
        } = store.mint(request("graph", "h1"));
        let b = store.mint(request("graph", "h2")).token;
        let c = store.mint(request("other", "h1")).token;
        store.mint(request("graph", "h1"));
        assert_eq!(store.projects_of("graph"), [1]);
        assert_eq!(store.revoke_project("graph", 2), 0);
        assert_eq!(store.revoke_stale("graph", Some("h2")), 2);
        assert!(grant_a.revoked.is_cancelled());
        assert!(store.resolve(&a).is_none() && store.resolve(&b).is_some());
        assert_eq!(store.revoke_plugin("graph"), 1);
        assert!(store.resolve(&b).is_none());
        let other = store.resolve(&c).unwrap();
        assert!(store.revoke_key(&other.key));
        assert!(!store.revoke_key(&other.key));
        assert!(other.revoked.is_cancelled());
        assert_eq!(store.len(), 0);
    }

    #[test]
    fn other_live_grants_are_counted_per_feature() {
        let store = GrantStore::default();
        let own = store.mint(
            GrantRequest::builder()
                .plugin_id("graph".into())
                .project_id(1)
                .feature_id(2)
                .scopes(vec![])
                .permissions_hash("h".into())
                .ttl(Duration::from_secs(3600))
                .build(),
        );
        assert!(own.expires_at - Utc::now() > chrono::Duration::minutes(59));
        assert!(!store.has_other_live("graph", 2, &own.grant.key));
        let instance = store.mint(request("graph", "h")).grant;
        assert!(store.has_other_live("graph", 2, &own.grant.key));
        assert!(!store.has_other_live("graph", 3, &own.grant.key));
        store.revoke_key(&instance.key);
        assert!(!store.has_other_live("graph", 2, &own.grant.key));
    }

    #[test]
    fn expired_grants_are_pruned_and_cancelled() {
        let store = GrantStore::default();
        let Minted { token, grant, .. } = store.mint(request("graph", "h1"));
        store.lock().get_mut(&grant.key).unwrap().expires = Instant::now() - Duration::from_secs(1);
        assert!(store.resolve(&token).is_none());
        assert!(grant.revoked.is_cancelled());
        assert_eq!(store.len(), 0);
    }

    #[tokio::test]
    async fn watcher_events_revoke_only_grants_the_manifest_no_longer_matches() {
        use crate::domain::plugin_tabs::test_support::write_tab;
        write_tab("graph", serde_json::json!({}));
        let hash = registry::get("graph")
            .await
            .unwrap()
            .permissions_hash()
            .unwrap();
        let store = GrantStore::default();
        let live = store.mint(request("graph", &hash)).token;
        let stale = store.mint(request("graph", "old")).token;
        let (tx, rx) = broadcast::channel(4);
        let task = tokio::spawn(revoke_on_manifest_change(store.clone(), rx));
        tx.send(PluginTabChangedEvent {
            plugin_id: "graph".into(),
        })
        .unwrap();
        drop(tx);
        task.await.unwrap();
        assert!(store.resolve(&live).is_some());
        assert!(store.resolve(&stale).is_none());
    }
}
