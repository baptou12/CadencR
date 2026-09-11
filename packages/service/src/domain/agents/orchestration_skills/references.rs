//! Scanner for virtual skill references embedded *inside* a message.
//!
//! A leading `/cadencr:<name>` is a command invocation (see `expand_prompt`);
//! anything further in is a *reference*: the user wrote a normal sentence and
//! named a skill in it. This module answers the single question "which skill
//! names does this message reference?" and is deliberately conservative — a
//! false positive silently rewrites the user's prompt.
//!
//! Recognized: an explicit `/cadencr:<name>` or `$cadencr:<name>` token that
//! starts the text or follows whitespace, whose name is followed by a boundary
//! (end of text or a character that cannot continue an identifier or a path).
//!
//! Skipped: fenced code blocks, inline code spans, Markdown block quotes, and
//! anything not preceded by whitespace — which covers escaped forms
//! (`\/cadencr:x`), URLs (`https://host/cadencr:x`), and leading punctuation.
//! The bare `cadencr:<name>` form is never a reference; it only works as a
//! leading command, so ordinary prose about `cadencr:status` stays prose.

use super::ORCHESTRATION_SKILL_PREFIX;

/// Every skill name referenced in `text`, in order of appearance (duplicates
/// included — the caller owns catalog lookup and de-duplication).
pub(super) fn scan_references(text: &str) -> Vec<&str> {
    let mut names = Vec::new();
    let mut in_fenced_block = false;
    for line in text.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fenced_block = !in_fenced_block;
            continue;
        }
        if in_fenced_block || trimmed.starts_with('>') {
            continue;
        }
        scan_line(line, &mut names);
    }
    names
}

fn scan_line<'a>(line: &'a str, names: &mut Vec<&'a str>) {
    let code_spans = inline_code_spans(line);
    for (index, character) in line.char_indices() {
        if character != '/' && character != '$' {
            continue;
        }
        if code_spans
            .iter()
            .any(|(start, end)| (*start..*end).contains(&index))
        {
            continue;
        }
        if !line[..index]
            .chars()
            .next_back()
            .is_none_or(char::is_whitespace)
        {
            continue;
        }
        if let Some(name) = reference_name(&line[index + character.len_utf8()..]) {
            names.push(name);
        }
    }
}

/// Reads `cadencr:<name>` at the start of `text`, requiring a clean trailing
/// boundary so `/cadencr:reviewer`, `/cadencr:review/x` and `/cadencr:review:x`
/// do not match the `review` skill.
fn reference_name(text: &str) -> Option<&str> {
    let after_prefix = text.strip_prefix(ORCHESTRATION_SKILL_PREFIX)?;
    let name_len = after_prefix
        .bytes()
        .take_while(|byte| byte.is_ascii_alphanumeric() || *byte == b'-')
        .count();
    if name_len == 0 {
        return None;
    }
    let boundary = after_prefix[name_len..].chars().next();
    if boundary.is_some_and(|c| c.is_alphanumeric() || c == ':' || c == '/' || c == '_') {
        return None;
    }
    Some(&after_prefix[..name_len])
}

/// Byte ranges covered by inline code spans, matching runs of backticks pairwise
/// the way Markdown does. An unclosed run is not a span, so a lone backtick in
/// prose does not mask the rest of the line.
fn inline_code_spans(line: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let bytes = line.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'`' {
            index += 1;
            continue;
        }
        let open_start = index;
        let fence_len = bytes[index..].iter().take_while(|b| **b == b'`').count();
        index += fence_len;
        match closing_run(bytes, index, fence_len) {
            Some(close_end) => {
                spans.push((open_start, close_end));
                index = close_end;
            }
            None => break,
        }
    }
    spans
}

/// End offset of the next run of exactly `fence_len` backticks at or after `from`.
fn closing_run(bytes: &[u8], from: usize, fence_len: usize) -> Option<usize> {
    let mut index = from;
    while index < bytes.len() {
        if bytes[index] != b'`' {
            index += 1;
            continue;
        }
        let run = bytes[index..].iter().take_while(|b| **b == b'`').count();
        if run == fence_len {
            return Some(index + run);
        }
        index += run;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::scan_references;

    #[test]
    fn finds_references_mid_sentence_for_both_prefixes() {
        assert_eq!(
            scan_references("Check the diff, then /cadencr:review focusing on UX."),
            vec!["review"]
        );
        assert_eq!(
            scan_references("Check the diff, then $cadencr:review focusing on UX."),
            vec!["review"]
        );
    }

    #[test]
    fn keeps_appearance_order_and_duplicates_for_the_caller() {
        assert_eq!(
            scan_references("/cadencr:status then /cadencr:review then /cadencr:status"),
            vec!["status", "review", "status"]
        );
    }

    #[test]
    fn finds_references_on_any_line_of_a_multiline_message() {
        assert_eq!(
            scan_references("first line\n\nthen /cadencr:review\nand /cadencr:status"),
            vec!["review", "status"]
        );
    }

    #[test]
    fn ignores_fenced_code_blocks() {
        let text = "Example:\n\n```text\n/cadencr:review\n```\n\nDon't run it.";
        assert!(scan_references(text).is_empty());
    }

    #[test]
    fn ignores_tilde_fences_and_resumes_after_them() {
        let text = "~~~\n/cadencr:status\n~~~\n\nnow /cadencr:review";
        assert_eq!(scan_references(text), vec!["review"]);
    }

    #[test]
    fn ignores_inline_code_spans() {
        assert!(scan_references("type `/cadencr:review` to review").is_empty());
        assert!(scan_references("type `run /cadencr:review now` please").is_empty());
        assert_eq!(
            scan_references("`/cadencr:status` is documented, run /cadencr:review"),
            vec!["review"]
        );
    }

    #[test]
    fn an_unclosed_backtick_does_not_mask_the_rest_of_the_line() {
        assert_eq!(
            scan_references("weird ` quote then /cadencr:review"),
            vec!["review"]
        );
    }

    #[test]
    fn ignores_markdown_block_quotes() {
        assert!(scan_references("> the docs say /cadencr:review\n").is_empty());
        assert_eq!(
            scan_references("> quoted /cadencr:status\n\nbut now /cadencr:review"),
            vec!["review"]
        );
    }

    #[test]
    fn ignores_escaped_urls_and_leading_punctuation() {
        for text in [
            r"escaped \/cadencr:review stays text",
            r"escaped \$cadencr:review stays text",
            "see https://example.com/cadencr:review for docs",
            "see (/cadencr:review) in the docs",
            "path a//cadencr:review",
        ] {
            assert!(scan_references(text).is_empty(), "text {text:?}");
        }
    }

    #[test]
    fn ignores_the_bare_namespace_form_mid_message() {
        assert!(scan_references("please run cadencr:status later").is_empty());
    }

    #[test]
    fn requires_a_clean_token_boundary_after_the_name() {
        // A longer identifier or path is a different token, never the `review`
        // skill with trailing noise.
        for text in [
            "/cadencr:review/extra",
            "/cadencr:review:extra",
            "/cadencr:review_extra",
        ] {
            assert!(!scan_references(text).contains(&"review"), "text {text:?}");
        }
        assert_eq!(scan_references("/cadencr:reviewer"), vec!["reviewer"]);
        assert!(scan_references("/cadencr:").is_empty());
    }

    #[test]
    fn accepts_trailing_sentence_punctuation() {
        for text in [
            "then /cadencr:review.",
            "then /cadencr:review, please",
            "then /cadencr:review!",
            "then /cadencr:review\nnext line",
        ] {
            assert_eq!(scan_references(text), vec!["review"], "text {text:?}");
        }
    }

    #[test]
    fn reports_unknown_names_for_the_caller_to_reject() {
        assert_eq!(scan_references("try /cadencr:nope here"), vec!["nope"]);
    }
}
