//! Reading a forge's "come back later" out of a rejected response.
//!
//! Split out from the transport itself because the interesting part is not the
//! waiting, it is the *classification*: a throttled request and a token missing
//! a scope both arrive as `403`, and only one of them is worth telling the user
//! to go reconnect their provider.

use std::time::Duration;

/// Used when a forge refuses a request without saying when to come back.
pub(super) const DEFAULT_RATE_LIMIT_WAIT: Duration = Duration::from_secs(60);

/// How long a rate-limited response wants us to wait, or `None` when it isn't a
/// rate limit at all.
///
/// `Retry-After` is checked first because it is the only signal a *secondary*
/// limit sets: that one throttles request bursts rather than the hourly quota,
/// so `x-ratelimit-remaining` is still comfortably above zero while the request
/// is being refused.
pub(super) fn rate_limit_wait(response: &reqwest::Response) -> Option<Duration> {
    retry_after(response).or_else(|| {
        github_rate_limit_exhausted(response)
            .then(|| github_reset_wait(response).unwrap_or(DEFAULT_RATE_LIMIT_WAIT))
    })
}

/// A secondary limit that arrived with no rate-limit headers whatsoever. The
/// body is then the only thing separating it from a token that genuinely lacks
/// the scope, so match the two phrasings GitHub uses and nothing looser — a
/// stray "rate limit" in some other error would send a real permission problem
/// into a silent hour of backoff.
pub(super) fn is_secondary_rate_limit(body: &str) -> bool {
    let body = body.to_ascii_lowercase();
    body.contains("secondary rate limit") || body.contains("abuse detection")
}

fn retry_after(response: &reqwest::Response) -> Option<Duration> {
    response
        .headers()
        .get(reqwest::header::RETRY_AFTER)?
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

/// Build a response without a server. Every case that matters here turns on
/// status, headers, and body, none of which need a real socket.
#[cfg(test)]
pub(super) fn test_response(
    status: u16,
    headers: &[(&str, &str)],
    body: &str,
) -> reqwest::Response {
    let mut builder = axum::http::Response::builder().status(status);
    for (name, value) in headers {
        builder = builder.header(*name, *value);
    }
    reqwest::Response::from(builder.body(body.to_string()).expect("build test response"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_burst_limit_is_read_from_retry_after_alone() {
        // The header the secondary limit sets, with the hourly quota untouched
        // — the combination that used to read as an auth failure.
        let throttled = test_response(403, &[("retry-after", "30")], "");
        let healthy = test_response(403, &[("x-ratelimit-remaining", "4873")], "");

        assert_eq!(rate_limit_wait(&throttled), Some(Duration::from_secs(30)));
        assert_eq!(rate_limit_wait(&healthy), None);
    }

    #[test]
    fn an_exhausted_quota_waits_for_the_reset_stamp() {
        let reset = chrono::Utc::now().timestamp() + 120;
        let response = test_response(
            403,
            &[
                ("x-ratelimit-remaining", "0"),
                ("x-ratelimit-reset", &reset.to_string()),
            ],
            "",
        );

        let wait = rate_limit_wait(&response).expect("exhausted quota is a rate limit");
        assert!(
            (119..=121).contains(&wait.as_secs()),
            "expected ~120s, got {wait:?}"
        );
    }

    #[test]
    fn a_past_reset_stamp_still_waits_a_moment() {
        // Clock skew must not produce a zero-length pause that lets the next
        // poll hammer the forge immediately.
        let response = test_response(
            403,
            &[
                ("x-ratelimit-remaining", "0"),
                ("x-ratelimit-reset", "1000"),
            ],
            "",
        );

        assert_eq!(rate_limit_wait(&response), Some(Duration::from_secs(1)));
    }

    #[test]
    fn only_githubs_own_wording_counts_as_a_secondary_limit() {
        assert!(is_secondary_rate_limit(
            "You have exceeded a SECONDARY RATE LIMIT"
        ));
        assert!(is_secondary_rate_limit(
            "You have triggered an abuse detection mechanism"
        ));
        // A permission error that merely mentions limits must not be mistaken
        // for one, or a real failure would disappear into an hour of backoff.
        assert!(!is_secondary_rate_limit(
            "Your token cannot read rate limit settings for this org"
        ));
        assert!(!is_secondary_rate_limit(""));
    }
}
