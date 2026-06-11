use crate::domain::agents::response_style::rich_markdown_system_prompt;

pub(super) const CODEX_MCP_INSTRUCTIONS: &str = r#"## Codex-specific Cadencr MCP guidance

Cadencr MCP tools may appear in either canonical or Codex namespace form. Treat these as equivalent:
- `mcp__cadencr-browser__browser_open_url` ↔ `mcp__cadencr_browser____browser_open_url`

When the prompt names canonical `mcp__cadencr-*__*` tools, use the matching
Codex namespace tool if that is the form exposed in your tool list."#;

pub(super) fn codex_developer_instructions() -> String {
    rich_markdown_system_prompt(Some(CODEX_MCP_INSTRUCTIONS))
}

pub(super) fn codex_system_prompt(system_prompt: Option<&str>) -> String {
    let prompt = system_prompt
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
        .map(|prompt| format!("{prompt}\n\n{CODEX_MCP_INSTRUCTIONS}"))
        .unwrap_or_else(|| CODEX_MCP_INSTRUCTIONS.to_string());
    rich_markdown_system_prompt(Some(&prompt))
}

#[cfg(test)]
mod tests {
    use super::{codex_developer_instructions, codex_system_prompt};
    use crate::domain::agents::response_style::RICH_MARKDOWN_INSTRUCTION;

    #[test]
    fn codex_system_prompt_keeps_base_prompt_and_adds_tool_aliases() {
        let prompt = codex_system_prompt(Some("Base session prompt"));

        assert!(prompt.starts_with(RICH_MARKDOWN_INSTRUCTION));
        assert!(prompt.contains("Base session prompt"));
        assert!(prompt.contains("mcp__cadencr-browser__browser_open_url"));
        assert!(prompt.contains("mcp__cadencr_browser____browser_open_url"));
    }

    #[test]
    fn codex_developer_instructions_include_markdown_and_mcp_guidance() {
        let instructions = codex_developer_instructions();

        assert!(instructions.starts_with(RICH_MARKDOWN_INSTRUCTION));
        assert!(instructions.contains("mcp__cadencr-browser__browser_open_url"));
        assert!(instructions.contains("mcp__cadencr_browser____browser_open_url"));
    }
}
