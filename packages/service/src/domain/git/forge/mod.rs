mod activity;
mod auth;
mod bitbucket;
mod cache;
mod github;
mod github_repository;
mod gitlab;
mod http;
mod poller;
mod provider;
mod repository;
pub mod routes;

pub use activity::ForgeActivityTracker;
pub use auth::{ForgeAuthStore, FORGE_HOSTS_SETTING};
pub use cache::ForgeStatusCache;
pub use http::ForgeHttp;
pub use poller::spawn;
pub use provider::*;

use crate::domain::git::host::GitHost;

static GITHUB: github::GitHubProvider = github::GitHubProvider;
static GITLAB: gitlab::GitLabProvider = gitlab::GitLabProvider;
static BITBUCKET: bitbucket::BitbucketProvider = bitbucket::BitbucketProvider;

pub fn provider_for(kind: GitHost) -> Option<&'static dyn ForgeProvider> {
    match kind {
        GitHost::GitHub => Some(&GITHUB),
        GitHost::GitLab => Some(&GITLAB),
        GitHost::Bitbucket => Some(&BITBUCKET),
        GitHost::Other => None,
    }
}

pub fn api_base_url(
    hostname: &str,
    kind: GitHost,
    configured: Option<&ForgeHostConfig>,
) -> Option<String> {
    if let Some(configured) = configured
        .and_then(|config| config.api_base_url.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(configured.trim_end_matches('/').to_string());
    }
    match kind {
        GitHost::GitHub if hostname.eq_ignore_ascii_case("github.com") => {
            Some("https://api.github.com".into())
        }
        GitHost::GitHub => Some(format!("https://{hostname}/api/v3")),
        GitHost::GitLab => Some(format!("https://{hostname}/api/v4")),
        GitHost::Bitbucket if hostname.eq_ignore_ascii_case("bitbucket.org") => {
            Some("https://api.bitbucket.org/2.0".into())
        }
        GitHost::Bitbucket | GitHost::Other => None,
    }
}

pub fn effective_kind(detected: GitHost, configured: Option<&ForgeHostConfig>) -> GitHost {
    configured.map_or(detected, |config| config.kind)
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::collections::HashMap;
    use std::sync::Arc;

    use axum::extract::{OriginalUri, State};
    use axum::routing::get;
    use axum::{Json, Router};
    use serde_json::Value;

    use super::{ForgeAuthSource, ForgeContext, ForgeCredentials, ForgeHttp};
    use crate::domain::git::host::{GitHost, RemoteInfo};

    pub async fn json_fixture_server(routes: HashMap<String, Value>) -> String {
        async fn fixture(
            State(routes): State<Arc<HashMap<String, Value>>>,
            OriginalUri(uri): OriginalUri,
        ) -> Json<Value> {
            Json(
                routes
                    .get(uri.path())
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({ "error": "fixture route missing" })),
            )
        }

        let app = Router::new()
            .fallback(get(fixture))
            .with_state(Arc::new(routes));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind fixture server");
        let address = listener.local_addr().expect("fixture server address");
        tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("fixture server stays available");
        });
        format!("http://{address}")
    }

    pub fn fixture(name: &str) -> Value {
        let raw = match name {
            "github_pulls" => include_str!("fixtures/github_pulls.json"),
            "gitlab_merge_requests" => include_str!("fixtures/gitlab_merge_requests.json"),
            "bitbucket_pullrequests" => include_str!("fixtures/bitbucket_pullrequests.json"),
            _ => panic!("unknown fixture"),
        };
        serde_json::from_str(raw).expect("valid recorded forge fixture")
    }

    pub fn context(api_base_url: String, host: GitHost) -> ForgeContext {
        ForgeContext {
            remote: RemoteInfo {
                host,
                hostname: "forge.test".into(),
                web_base: "https://forge.test".into(),
                owner: "acme".into(),
                repo: "repo".into(),
            },
            api_base_url,
            credentials: ForgeCredentials {
                token: "fixture-token".into(),
                username: Some("developer@example.com".into()),
                source: ForgeAuthSource::Stored,
            },
            http: Arc::new(ForgeHttp::default()),
        }
    }
}
