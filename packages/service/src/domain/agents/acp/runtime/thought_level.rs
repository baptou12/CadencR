//! Shared ACP thought-level / effort config option names.

/// True when a `config_option_update` name or Cursor config id should mirror
/// into Cadencr's thinking-effort session state.
pub fn is_thought_level_config_name(name: &str) -> bool {
    matches!(
        name,
        "thinkingEffort" | "effort" | "reasoning" | "thought_level"
    )
}
