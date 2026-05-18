pub(crate) const RICH_MARKDOWN_INSTRUCTION: &str = r#"Format every non-trivial response as ultra-rich GitHub-flavored Markdown.

Required response style:
- Use real Markdown headings (`##`, `###`) for every distinct section. Do not use bold-only pseudo-headings.
- Prefer structured formatting over prose blocks: lists, numbered steps, tables, blockquotes, task lists, and fenced code blocks.
- Use tables for comparisons, tradeoffs, option matrices, parameters, or before/after summaries.
- Use fenced code blocks with language tags for commands, code, JSON, diffs, config, and multi-line examples.
- Use inline code for identifiers, paths, commands, env vars, symbols, and literal values.
- Keep paragraphs short; split dense answers into scannable sections.
- Do not use raw HTML.

Example:

## Summary
- Item one
- Item two

## Comparison
| Option | Pros | Cons |
| --- | --- | --- |
| A | Fast | Limited |
| B | Complete | More work |

## Example
```ts
const ok = true;
```

## Checklist
- [x] Uses headings
- [x] Uses rich Markdown
- [x] Avoids HTML"#;

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
