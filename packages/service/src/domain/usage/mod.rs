/// Returns the context window size (in tokens) for a given Claude model identifier.
///
/// Model IDs may include date suffixes (e.g. `claude-opus-4-6-20260101`).
/// We match on known prefixes — latest generation models (Opus 4.6, Sonnet 4.6)
/// default to 1M; older models and Haiku default to 200k.
pub fn context_window_for_model(model: &str) -> u64 {
    const CONTEXT_1M: u64 = 1_000_000;
    const CONTEXT_200K: u64 = 200_000;

    // Normalise: Claude Code may report short aliases like "opus", "sonnet"
    let m = model.to_lowercase();

    // 1M context models (latest generation)
    if m.starts_with("claude-opus-4-6") || m.starts_with("claude-sonnet-4-6") {
        return CONTEXT_1M;
    }

    // Short aliases used internally
    if m == "opus" || m == "sonnet" {
        // Default aliases point to latest generation
        return CONTEXT_1M;
    }

    // Everything else: 200k (Haiku, older Opus/Sonnet, etc.)
    CONTEXT_200K
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_context_window_for_model() {
        assert_eq!(context_window_for_model("claude-opus-4-6"), 1_000_000);
        assert_eq!(context_window_for_model("claude-opus-4-6-20260101"), 1_000_000);
        assert_eq!(context_window_for_model("claude-sonnet-4-6"), 1_000_000);
        assert_eq!(context_window_for_model("claude-sonnet-4-6-20260301"), 1_000_000);
        assert_eq!(context_window_for_model("opus"), 1_000_000);
        assert_eq!(context_window_for_model("sonnet"), 1_000_000);
        assert_eq!(context_window_for_model("claude-haiku-4-5-20251001"), 200_000);
        assert_eq!(context_window_for_model("claude-opus-4-5"), 200_000);
        assert_eq!(context_window_for_model("claude-sonnet-4"), 200_000);
        assert_eq!(context_window_for_model("claude-sonnet-4-20250514"), 200_000);
        assert_eq!(context_window_for_model("unknown-model"), 200_000);
    }
}
