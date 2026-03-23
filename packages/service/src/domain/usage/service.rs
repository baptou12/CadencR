use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;

use super::models::{UsageBucket, UsageResponse, UsageStatus};

const CACHE_TTL_MS: u64 = 5 * 60 * 1000;
const RATE_LIMIT_FLOOR_MS: u64 = 20 * 60 * 1000;

struct CachedUsage {
    data: UsageResponse,
    fetched_at: u64,
    rate_limited_until: Option<u64>,
}

static CACHE: LazyLock<RwLock<Option<CachedUsage>>> = LazyLock::new(|| RwLock::new(None));

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn empty_response(status: UsageStatus, message: Option<String>, retry_at: Option<u64>) -> UsageResponse {
    UsageResponse {
        five_hour: None,
        seven_day: None,
        seven_day_sonnet: None,
        status,
        status_message: message,
        retry_at,
        updated_at: now_ms(),
    }
}

pub async fn get_usage() -> UsageResponse {
    // Check rate-limit backoff
    {
        let cache = CACHE.read().await;
        if let Some(ref cached) = *cache {
            if let Some(until) = cached.rate_limited_until {
                if now_ms() < until {
                    return UsageResponse {
                        status: UsageStatus::RateLimited,
                        status_message: None,
                        retry_at: Some(until),
                        updated_at: cached.data.updated_at,
                        ..cached.data.clone()
                    };
                }
            }
            // Return cached if fresh
            if now_ms() - cached.fetched_at < CACHE_TTL_MS {
                return cached.data.clone();
            }
        }
    }

    // Fetch fresh data
    match fetch_from_api().await {
        Ok(data) => {
            let mut cache = CACHE.write().await;
            *cache = Some(CachedUsage {
                data: data.clone(),
                fetched_at: now_ms(),
                rate_limited_until: None,
            });
            data
        }
        Err(FetchError::RateLimited) => {
            let until = now_ms() + RATE_LIMIT_FLOOR_MS;
            let mut cache = CACHE.write().await;
            if let Some(ref mut cached) = *cache {
                cached.rate_limited_until = Some(until);
                return UsageResponse {
                    status: UsageStatus::RateLimited,
                    status_message: None,
                    retry_at: Some(until),
                    updated_at: cached.data.updated_at,
                    ..cached.data.clone()
                };
            }
            *cache = Some(CachedUsage {
                data: empty_response(UsageStatus::RateLimited, None, Some(until)),
                fetched_at: 0,
                rate_limited_until: Some(until),
            });
            empty_response(UsageStatus::RateLimited, None, Some(until))
        }
        Err(FetchError::Other(msg)) => {
            let cache = CACHE.read().await;
            if let Some(ref cached) = *cache {
                return UsageResponse {
                    status: UsageStatus::Error,
                    status_message: Some(msg),
                    retry_at: None,
                    updated_at: cached.data.updated_at,
                    ..cached.data.clone()
                };
            }
            empty_response(UsageStatus::Error, Some(msg), None)
        }
    }
}

enum FetchError {
    RateLimited,
    Other(String),
}

async fn get_oauth_token() -> Result<String, FetchError> {
    let output = tokio::process::Command::new("security")
        .args(["find-generic-password", "-s", "Claude Code-credentials", "-w"])
        .output()
        .await
        .map_err(|e| FetchError::Other(format!("Keychain access failed: {e}")))?;

    if !output.status.success() {
        return Err(FetchError::Other("Keychain access failed".to_string()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim())
        .map_err(|e| FetchError::Other(format!("Failed to parse keychain data: {e}")))?;

    parsed["claudeAiOauth"]["accessToken"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| FetchError::Other("No OAuth token found".to_string()))
}

#[derive(serde::Deserialize)]
struct RawBucket {
    utilization: Option<f64>,
    resets_at: Option<String>,
}

#[derive(serde::Deserialize)]
struct RawUsageResponse {
    five_hour: Option<RawBucket>,
    seven_day: Option<RawBucket>,
    seven_day_sonnet: Option<RawBucket>,
}

fn parse_bucket(raw: Option<RawBucket>) -> Option<UsageBucket> {
    raw.map(|b| UsageBucket {
        utilization: b.utilization.unwrap_or(0.0),
        resets_at: b.resets_at,
    })
}

async fn fetch_from_api() -> Result<UsageResponse, FetchError> {
    let token = get_oauth_token().await?;

    let client = reqwest::Client::new();
    let res = client
        .get("https://api.anthropic.com/api/oauth/usage")
        .header("Authorization", format!("Bearer {token}"))
        .header("anthropic-beta", "oauth-2025-04-20")
        .send()
        .await
        .map_err(|e| FetchError::Other(e.to_string()))?;

    if res.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(FetchError::RateLimited);
    }

    if !res.status().is_success() {
        return Err(FetchError::Other(format!("{} {}", res.status().as_u16(), res.status().canonical_reason().unwrap_or(""))));
    }

    let raw: RawUsageResponse = res
        .json()
        .await
        .map_err(|e| FetchError::Other(format!("JSON parse failed: {e}")))?;

    Ok(UsageResponse {
        five_hour: parse_bucket(raw.five_hour),
        seven_day: parse_bucket(raw.seven_day),
        seven_day_sonnet: parse_bucket(raw.seven_day_sonnet),
        status: UsageStatus::Success,
        status_message: None,
        retry_at: None,
        updated_at: now_ms(),
    })
}
