pub mod adapter;
pub mod claude_code;
pub mod runtime;

use adapter::AgentRuntimeAdapter;

pub fn runtime_adapter(provider_id: &str) -> Option<&'static dyn AgentRuntimeAdapter> {
    match provider_id {
        "claude_code" => Some(&claude_code::CLAUDE_CODE_ADAPTER),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::runtime_adapter;

    #[test]
    fn test_runtime_adapter_registry_has_claude_only() {
        assert!(runtime_adapter("claude_code").is_some());
        assert!(runtime_adapter("codex_cli").is_none());
        assert!(runtime_adapter("opencode").is_none());
        assert!(runtime_adapter("unknown").is_none());
    }
}
