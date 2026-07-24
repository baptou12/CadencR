use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::time::{Duration, Instant};

use reqwest::header::{ETAG, IF_NONE_MATCH, RETRY_AFTER};
use reqwest::{RequestBuilder, StatusCode};
use serde::de::DeserializeOwned;
use tokio::sync::Mutex;

use super::provider::ForgeError;

#[derive(Clone)]
struct CachedResponse {
    etag: String,
    body: Vec<u8>,
}

const MAX_ETAG_ENTRIES: usize = 512;

/// Shared forge HTTP transport.
///
/// Adapters own endpoint/auth-header details; this type owns the cross-provider
/// operational policy: conditional GETs, response-body reuse for `304`, and
/// host-scoped rate-limit backoff.
pub struct ForgeHttp {
    client: reqwest::Client,
    cache: Mutex<HashMap<String, CachedResponse>>,
    backoff_until: Mutex<HashMap<String, Instant>>,
}

impl Default for ForgeHttp {
    fn default() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(concat!("Cadencr/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap_or_else(|error| {
                tracing::warn!(%error, "failed to build forge HTTP client; using defaults");
                reqwest::Client::new()
            });
        Self {
            client,
            cache: Mutex::new(HashMap::new()),
            backoff_until: Mutex::new(HashMap::new()),
        }
    }
}

impl ForgeHttp {
    pub fn get(&self, url: &str) -> RequestBuilder {
        self.client.get(url)
    }

    pub async fn get_json<T: DeserializeOwned>(
        &self,
        builder: RequestBuilder,
    ) -> Result<T, ForgeError> {
        let mut request = builder
            .build()
            .map_err(|error| ForgeError::Http(format!("invalid forge request: {error}")))?;
        // Conditional responses must never cross authentication contexts. In
        // particular, `/user` often emits ETags: keying by URL alone could make
        // a newly-entered token validate as the previously-connected account.
        let cache_key = response_cache_key(&request);
        let host = request.url().host_str().unwrap_or("forge").to_string();
        self.check_backoff(&host).await?;

        if let Some(cached) = self.cache.lock().await.get(&cache_key).cloned() {
            let value = reqwest::header::HeaderValue::from_str(&cached.etag)
                .map_err(|error| ForgeError::Http(format!("invalid cached ETag: {error}")))?;
            request.headers_mut().insert(IF_NONE_MATCH, value);
        }

        let response = self
            .client
            .execute(request)
            .await
            .map_err(|error| ForgeError::Http(format!("forge request failed: {error}")))?;
        let status = response.status();
        if status == StatusCode::NOT_MODIFIED {
            let cached = self
                .cache
                .lock()
                .await
                .get(&cache_key)
                .cloned()
                .ok_or_else(|| {
                    ForgeError::Response("forge returned 304 without a cached response".into())
                })?;
            return serde_json::from_slice(&cached.body).map_err(|error| {
                ForgeError::Response(format!("cached forge response was invalid: {error}"))
            });
        }
        if status == StatusCode::TOO_MANY_REQUESTS {
            let wait = retry_after(&response).unwrap_or(Duration::from_secs(60));
            self.backoff_until
                .lock()
                .await
                .insert(host, Instant::now() + wait);
            return Err(ForgeError::RateLimited(format!(
                "Forge rate limit reached; retrying in {}s",
                wait.as_secs()
            )));
        }
        if status == StatusCode::UNAUTHORIZED {
            return Err(ForgeError::Authentication(
                "Forge rejected the configured token".into(),
            ));
        }
        if status == StatusCode::FORBIDDEN && github_rate_limit_exhausted(&response) {
            let wait = github_reset_wait(&response).unwrap_or(Duration::from_secs(60));
            self.backoff_until
                .lock()
                .await
                .insert(host, Instant::now() + wait);
            return Err(ForgeError::RateLimited(format!(
                "Forge rate limit reached; retrying in {}s",
                wait.as_secs()
            )));
        }
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            let detail = body.chars().take(500).collect::<String>();
            let message = if detail.trim().is_empty() {
                format!("Forge request failed with HTTP {status}")
            } else {
                format!("Forge request failed with HTTP {status}: {detail}")
            };
            return if status == StatusCode::FORBIDDEN {
                Err(ForgeError::Authentication(message))
            } else {
                Err(ForgeError::Http(message))
            };
        }

        let etag = response
            .headers()
            .get(ETAG)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let body = response
            .bytes()
            .await
            .map_err(|error| ForgeError::Http(format!("failed reading forge response: {error}")))?
            .to_vec();
        if let Some(etag) = etag {
            let mut cache = self.cache.lock().await;
            if cache.len() >= MAX_ETAG_ENTRIES {
                if let Some(victim) = cache.keys().next().cloned() {
                    cache.remove(&victim);
                }
            }
            cache.insert(
                cache_key,
                CachedResponse {
                    etag,
                    body: body.clone(),
                },
            );
        }
        serde_json::from_slice(&body)
            .map_err(|error| ForgeError::Response(format!("invalid forge response: {error}")))
    }

    async fn check_backoff(&self, host: &str) -> Result<(), ForgeError> {
        let mut backoff = self.backoff_until.lock().await;
        let Some(until) = backoff.get(host).copied() else {
            return Ok(());
        };
        let now = Instant::now();
        if now >= until {
            backoff.remove(host);
            return Ok(());
        }
        Err(ForgeError::RateLimited(format!(
            "Forge requests for {host} are paused for {}s",
            until.saturating_duration_since(now).as_secs()
        )))
    }
}

fn response_cache_key(request: &reqwest::Request) -> String {
    let mut hasher = DefaultHasher::new();
    for (name, value) in request.headers() {
        name.as_str().hash(&mut hasher);
        value.as_bytes().hash(&mut hasher);
    }
    format!("{}#{:016x}", request.url(), hasher.finish())
}

fn retry_after(response: &reqwest::Response) -> Option<Duration> {
    response
        .headers()
        .get(RETRY_AFTER)?
        .to_str()
        .ok()?
        .parse::<u64>()
        .ok()
        .map(Duration::from_secs)
}

fn github_rate_limit_exhausted(response: &reqwest::Response) -> bool {
    response
        .headers()
        .get("x-ratelimit-remaining")
        .and_then(|value| value.to_str().ok())
        == Some("0")
}

fn github_reset_wait(response: &reqwest::Response) -> Option<Duration> {
    let reset = response
        .headers()
        .get("x-ratelimit-reset")?
        .to_str()
        .ok()?
        .parse::<i64>()
        .ok()?;
    let seconds = reset.saturating_sub(chrono::Utc::now().timestamp()).max(1);
    Some(Duration::from_secs(seconds as u64))
}
