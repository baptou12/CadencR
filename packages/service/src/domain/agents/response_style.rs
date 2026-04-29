pub(crate) const RICH_MARKDOWN_INSTRUCTION: &str = "Format every non-trivial response using rich GitHub-flavored Markdown. Use real headings, lists, tables, and fenced code blocks when they improve readability. Do not use bold-only pseudo-headings as a substitute for headings. For example:\n\n## Summary\n- Item one\n- Item two\n\n```ts\nconst ok = true;\n```";

pub(crate) fn rich_markdown_system_prompt(system_prompt: Option<&str>) -> String {
    let base = system_prompt
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty());

    match base {
        Some(prompt) => format!("{RICH_MARKDOWN_INSTRUCTION}\n\n{prompt}"),
        None => RICH_MARKDOWN_INSTRUCTION.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{rich_markdown_system_prompt, RICH_MARKDOWN_INSTRUCTION};

    #[test]
    fn rich_markdown_system_prompt_prepends_instruction() {
        let prompt = rich_markdown_system_prompt(Some("Base prompt"));
        assert!(prompt.starts_with(RICH_MARKDOWN_INSTRUCTION));
        assert!(prompt.ends_with("Base prompt"));
    }

    #[test]
    fn rich_markdown_system_prompt_uses_instruction_without_base_prompt() {
        assert_eq!(rich_markdown_system_prompt(None), RICH_MARKDOWN_INSTRUCTION);
    }
}
