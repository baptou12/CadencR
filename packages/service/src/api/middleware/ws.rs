use axum::{
    http::{header, HeaderMap},
    response::Response,
};

use super::response::{forbidden, unauthorized};

const WS_TOKEN_PREFIX: &str = "cadence-token.";

/// CORS doesn't apply to WebSockets; this is the only gate against drive-by
/// upgrades. Non-browser clients may omit `Origin` — they still must present
/// the bearer token via subprotocol.
pub fn validate_ws_origin(headers: &HeaderMap) -> Result<(), Response> {
    let Some(origin) = headers.get(header::ORIGIN) else {
        return Ok(());
    };
    let origin = match origin.to_str() {
        Ok(s) => s,
        Err(_) => return Err(forbidden("invalid origin")),
    };
    if is_allowed_ws_origin(origin) {
        Ok(())
    } else {
        Err(forbidden("origin not allowed"))
    }
}

fn is_allowed_ws_origin(origin: &str) -> bool {
    if origin == "tauri://localhost" {
        return true;
    }
    cfg!(debug_assertions)
        && (origin == "http://localhost:1420" || origin == "http://127.0.0.1:1420")
}

/// Returns the matched subprotocol string. The caller MUST echo it back via
/// `WebSocketUpgrade::protocols`, or the browser rejects the handshake.
/// `Ok(None)` when auth is disabled; `Err` when required but absent/wrong.
pub fn validate_ws_token<'a>(
    headers: &'a HeaderMap,
    expected_token: Option<&str>,
) -> Result<Option<&'a str>, Response> {
    let Some(expected) = expected_token else {
        return Ok(None);
    };

    // Sec-WebSocket-Protocol can be a single comma-list or repeated headers.
    for header_value in headers.get_all(header::SEC_WEBSOCKET_PROTOCOL).iter() {
        let Ok(raw) = header_value.to_str() else {
            continue;
        };
        for token in raw.split(',').map(str::trim) {
            if let Some(rest) = token.strip_prefix(WS_TOKEN_PREFIX) {
                if rest == expected {
                    return Ok(Some(token));
                }
            }
        }
    }

    Err(unauthorized())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderName, HeaderValue, StatusCode};

    fn make_headers(entries: &[(&str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in entries {
            h.append(
                HeaderName::from_bytes(k.as_bytes()).unwrap(),
                HeaderValue::from_str(v).unwrap(),
            );
        }
        h
    }

    #[test]
    fn origin_accepts_tauri_webview() {
        let h = make_headers(&[("origin", "tauri://localhost")]);
        assert!(validate_ws_origin(&h).is_ok());
    }

    #[test]
    fn origin_accepts_dev_server_in_debug() {
        let h = make_headers(&[("origin", "http://localhost:1420")]);
        assert!(validate_ws_origin(&h).is_ok());
    }

    #[test]
    fn origin_rejects_unknown() {
        let h = make_headers(&[("origin", "https://evil.example")]);
        let err = validate_ws_origin(&h).unwrap_err();
        assert_eq!(err.status(), StatusCode::FORBIDDEN);
    }

    #[test]
    fn origin_allows_missing() {
        let h = make_headers(&[]);
        assert!(validate_ws_origin(&h).is_ok());
    }

    #[test]
    fn token_ok_when_disabled() {
        let h = make_headers(&[]);
        assert_eq!(validate_ws_token(&h, None).unwrap(), None);
    }

    #[test]
    fn token_accepts_matching_subprotocol() {
        let h = make_headers(&[("sec-websocket-protocol", "cadence-token.secret")]);
        let picked = validate_ws_token(&h, Some("secret")).unwrap().unwrap();
        assert_eq!(picked, "cadence-token.secret");
    }

    #[test]
    fn token_accepts_comma_list_with_match() {
        let h = make_headers(&[(
            "sec-websocket-protocol",
            "other-proto, cadence-token.secret",
        )]);
        assert_eq!(
            validate_ws_token(&h, Some("secret")).unwrap().unwrap(),
            "cadence-token.secret"
        );
    }

    #[test]
    fn token_accepts_repeated_header() {
        let h = make_headers(&[
            ("sec-websocket-protocol", "other-proto"),
            ("sec-websocket-protocol", "cadence-token.secret"),
        ]);
        assert_eq!(
            validate_ws_token(&h, Some("secret")).unwrap().unwrap(),
            "cadence-token.secret"
        );
    }

    #[test]
    fn token_rejects_wrong_value() {
        let h = make_headers(&[("sec-websocket-protocol", "cadence-token.wrong")]);
        let err = validate_ws_token(&h, Some("secret")).unwrap_err();
        assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn token_rejects_missing_subprotocol() {
        let h = make_headers(&[]);
        let err = validate_ws_token(&h, Some("secret")).unwrap_err();
        assert_eq!(err.status(), StatusCode::UNAUTHORIZED);
    }
}
