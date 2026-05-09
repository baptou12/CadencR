#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum OpenCodeTransport {
    Http,
    Acp,
}

/// Default transport when `CADENCR_OPENCODE_TRANSPORT` is unset or
/// unrecognised. `cfg!(debug_assertions)` is `true` for `cargo run` /
/// `pnpm dev` builds and `false` for `cargo build --release` / packaged
/// Electron sidecars — same convention used elsewhere in the service
/// (`main.rs`, `api/middleware/ws.rs`) to gate dev-only behaviour.
pub(super) fn default_transport() -> OpenCodeTransport {
    if cfg!(debug_assertions) {
        OpenCodeTransport::Acp
    } else {
        OpenCodeTransport::Http
    }
}

pub(super) fn opencode_transport_env() -> OpenCodeTransport {
    match std::env::var("CADENCR_OPENCODE_TRANSPORT")
        .ok()
        .map(|s| s.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("acp") => OpenCodeTransport::Acp,
        Some("http") => OpenCodeTransport::Http,
        None | Some("") => default_transport(),
        Some(other) => {
            tracing::warn!(
                value = other,
                default = ?default_transport(),
                "unrecognised CADENCR_OPENCODE_TRANSPORT value; using default for build"
            );
            default_transport()
        }
    }
}

#[cfg(test)]
static TRANSPORT_ENV_GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
pub(super) fn with_transport_env<F: FnOnce()>(value: Option<&str>, f: F) {
    let _g = TRANSPORT_ENV_GUARD
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    let prev = std::env::var("CADENCR_OPENCODE_TRANSPORT").ok();
    match value {
        Some(v) => std::env::set_var("CADENCR_OPENCODE_TRANSPORT", v),
        None => std::env::remove_var("CADENCR_OPENCODE_TRANSPORT"),
    }
    f();
    match prev {
        Some(v) => std::env::set_var("CADENCR_OPENCODE_TRANSPORT", v),
        None => std::env::remove_var("CADENCR_OPENCODE_TRANSPORT"),
    }
}

#[cfg(test)]
mod tests {
    use super::{default_transport, opencode_transport_env, with_transport_env, OpenCodeTransport};

    #[test]
    fn default_transport_is_acp_in_debug_builds() {
        assert_eq!(default_transport(), OpenCodeTransport::Acp);
    }

    #[test]
    fn transport_env_defaults_to_build_default_when_unset() {
        with_transport_env(None, || {
            assert_eq!(opencode_transport_env(), default_transport());
        });
    }

    #[test]
    fn transport_env_acp_is_recognised_case_insensitively() {
        with_transport_env(Some("ACP"), || {
            assert_eq!(opencode_transport_env(), OpenCodeTransport::Acp);
        });
        with_transport_env(Some("acp"), || {
            assert_eq!(opencode_transport_env(), OpenCodeTransport::Acp);
        });
    }

    #[test]
    fn transport_env_explicit_http_overrides_dev_default() {
        with_transport_env(Some("http"), || {
            assert_eq!(opencode_transport_env(), OpenCodeTransport::Http);
        });
    }

    #[test]
    fn transport_env_unknown_value_falls_back_to_build_default() {
        with_transport_env(Some("websocket"), || {
            assert_eq!(opencode_transport_env(), default_transport());
        });
    }
}
