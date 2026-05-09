//! OpenCode transport selection.
//!
//! Hardcoded to ACP. The HTTP transport is dead code today and is slated for
//! removal in a follow-up; the existing `match` arms in `mod.rs` keep
//! compiling but the `Http` variant is unreachable in practice.
//!
//! The `CADENCR_OPENCODE_TRANSPORT` env var is **ignored** — leaving it set
//! has no effect.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum OpenCodeTransport {
    /// Dead variant kept only so the existing `match opencode_transport_env()`
    /// arms in `mod.rs` keep compiling. `opencode_transport_env()` never
    /// returns this value; remove the variant once those branches are
    /// excised.
    #[allow(dead_code)]
    Http,
    Acp,
}

/// Always returns [`OpenCodeTransport::Acp`]. OpenCode runs exclusively
/// over ACP; the HTTP path is preserved only until its dead branches in
/// `mod.rs` are removed.
pub(super) fn opencode_transport_env() -> OpenCodeTransport {
    OpenCodeTransport::Acp
}

#[cfg(test)]
mod tests {
    use super::{opencode_transport_env, OpenCodeTransport};

    #[test]
    fn opencode_transport_is_hardcoded_to_acp() {
        assert_eq!(opencode_transport_env(), OpenCodeTransport::Acp);
    }

    #[test]
    fn env_var_does_not_override_hardcoded_acp() {
        // Even when CADENCR_OPENCODE_TRANSPORT=http is set we must stay on
        // ACP. Guards against accidental re-introduction of an env-var
        // toggle.
        let prev = std::env::var("CADENCR_OPENCODE_TRANSPORT").ok();
        std::env::set_var("CADENCR_OPENCODE_TRANSPORT", "http");
        assert_eq!(opencode_transport_env(), OpenCodeTransport::Acp);
        match prev {
            Some(v) => std::env::set_var("CADENCR_OPENCODE_TRANSPORT", v),
            None => std::env::remove_var("CADENCR_OPENCODE_TRANSPORT"),
        }
    }
}
