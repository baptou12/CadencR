//! Scanner for virtual skill references embedded *inside* a message.
//!
//! A leading `/cadencr:<name>` is a command invocation (see `expand_prompt`);
//! anything further in is a *reference*: the user wrote a normal sentence and
//! named a skill in it. This module answers the single question "which skill
//! names does this message reference?" and is deliberately conservative — a
//! false positive silently rewrites the user's prompt, and a skill body can
//! tell the agent to spawn sessions, so a quoted example must never expand.
//!
//! Recognized: an explicit `/cadencr:<name>` or `$cadencr:<name>` token that
//! starts a prose block or follows whitespace, whose name is followed by a
//! boundary (end of text, or a character that cannot continue an identifier or
//! a path).
//!
//! Skipped: fenced code blocks, inline code spans, Markdown block quotes, and
//! anything not preceded by whitespace — which covers escaped forms
//! (`\/cadencr:x`), URLs (`https://host/cadencr:x`), and leading punctuation.
//! The bare `cadencr:<name>` form is never a reference; it only works as a
//! leading command, so ordinary prose about `cadencr:status` stays prose.
//!
//! Fences and code spans follow CommonMark closely enough to be safe rather
//! than complete: a fence closes only on the same marker, at least as long as
//! the opener and with nothing but spaces after it, and a code span may cross
//! lines within a paragraph. Indented (4-space) code blocks are not modelled.

use std::ops::Range;
use std::sync::LazyLock;

use regex_lite::Regex;

use super::ORCHESTRATION_SKILL_PREFIX;

/// Candidate reference token; the surrounding characters are checked in
/// `scan_block` because `regex_lite` has no look-around.
static REFERENCE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"[/$]cadencr:[A-Za-z0-9-]+").expect("skill reference regex must compile")
});

/// One opened fence: only a run of the same marker, at least as long, closes it.
struct Fence {
    marker: u8,
    run_len: usize,
}

/// Every skill name referenced in `text`, deduplicated in order of first
/// appearance. Catalog lookup stays with the caller — unknown names are
/// reported so it can leave them untouched.
pub(super) fn scan_references(text: &str) -> Vec<&str> {
    if !text.contains(ORCHESTRATION_SKILL_PREFIX) {
        return Vec::new();
    }
    let mut names: Vec<&str> = Vec::new();
    for block in prose_blocks(text) {
        for name in scan_block(block) {
            if !names.contains(&name) {
                names.push(name);
            }
        }
    }
    names
}

/// Split `text` into the stretches of scannable prose: consecutive lines that
/// are not inside a fence, not a block quote, and not blank. Blank lines end a
/// block because a code span cannot span a paragraph break.
fn prose_blocks(text: &str) -> Vec<&str> {
    let mut blocks = Vec::new();
    let mut fence: Option<Fence> = None;
    let mut block: Option<(usize, usize)> = None;
    let mut offset = 0;
    for line in text.split('\n') {
        let line_start = offset;
        let line_end = line_start + line.len();
        offset = line_end + 1;
        if is_prose(line, &mut fence) {
            let start = block.map_or(line_start, |(start, _)| start);
            block = Some((start, line_end));
        } else if let Some((start, end)) = block.take() {
            blocks.push(&text[start..end]);
        }
    }
    if let Some((start, end)) = block {
        blocks.push(&text[start..end]);
    }
    blocks
}

/// Whether `line` is scannable prose, advancing the fence state as it goes.
fn is_prose(line: &str, fence: &mut Option<Fence>) -> bool {
    if let Some(open) = fence {
        if closes_fence(line, open) {
            *fence = None;
        }
        return false;
    }
    if let Some(opened) = opens_fence(line) {
        *fence = Some(opened);
        return false;
    }
    let trimmed = line.trim_start();
    !trimmed.is_empty() && !trimmed.starts_with('>')
}

/// A run of three or more backticks or tildes opens a fence. A backtick fence's
/// info string may not contain a backtick, which keeps `` `a` `` prose.
fn opens_fence(line: &str) -> Option<Fence> {
    let trimmed = line.trim_start();
    let marker = match trimmed.as_bytes().first()? {
        b'`' => b'`',
        b'~' => b'~',
        _ => return None,
    };
    let run_len = trimmed.bytes().take_while(|byte| *byte == marker).count();
    if run_len < 3 || (marker == b'`' && trimmed[run_len..].contains('`')) {
        return None;
    }
    Some(Fence { marker, run_len })
}

/// Only the same marker, at least as long as the opener and followed by nothing
/// but spaces, closes a fence — so ``` never closes ```` and ~~~ never closes
/// a backtick fence.
fn closes_fence(line: &str, fence: &Fence) -> bool {
    let trimmed = line.trim_start();
    let run = trimmed
        .bytes()
        .take_while(|byte| *byte == fence.marker)
        .count();
    run >= fence.run_len && trimmed[run..].trim().is_empty()
}

/// Reference names in one prose block, in order, skipping inline code spans
/// and tokens without clean boundaries on both sides.
fn scan_block(block: &str) -> Vec<&str> {
    let code_spans = inline_code_spans(block);
    REFERENCE_REGEX
        .find_iter(block)
        .filter(|token| !code_spans.iter().any(|span| span.contains(&token.start())))
        .filter(|token| {
            block[..token.start()]
                .chars()
                .next_back()
                .is_none_or(char::is_whitespace)
        })
        .filter(|token| {
            // `/cadencr:review/x`, `:x`, `_x` are longer identifiers or paths,
            // never the `review` skill with trailing noise.
            let boundary = block[token.end()..].chars().next();
            !boundary.is_some_and(|c| c.is_alphanumeric() || matches!(c, ':' | '/' | '_'))
        })
        .map(|token| &block[token.start() + 1 + ORCHESTRATION_SKILL_PREFIX.len()..token.end()])
        .collect()
}

/// Byte ranges covered by inline code spans: an opening backtick run is closed
/// by the next run of exactly the same length, the way Markdown pairs them. A
/// run with no matching closer is literal text, so a later well-formed span
/// still masks its contents.
fn inline_code_spans(text: &str) -> Vec<Range<usize>> {
    let runs = backtick_runs(text);
    let mut spans = Vec::new();
    let mut current = 0;
    while let Some((open_start, open_len)) = runs.get(current).copied() {
        match runs[current + 1..]
            .iter()
            .position(|(_, run_len)| *run_len == open_len)
        {
            Some(closer) => {
                let (close_start, close_len) = runs[current + 1 + closer];
                spans.push(open_start..close_start + close_len);
                current += closer + 2;
            }
            None => current += 1,
        }
    }
    spans
}

/// Maximal runs of consecutive backticks as `(start, len)` pairs.
fn backtick_runs(text: &str) -> Vec<(usize, usize)> {
    let mut runs: Vec<(usize, usize)> = Vec::new();
    for (index, byte) in text.bytes().enumerate() {
        if byte != b'`' {
            continue;
        }
        match runs.last_mut() {
            Some((start, len)) if *start + *len == index => *len += 1,
            _ => runs.push((index, 1)),
        }
    }
    runs
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
    fn deduplicates_references_in_appearance_order() {
        assert_eq!(
            scan_references("/cadencr:status then /cadencr:review then /cadencr:status"),
            vec!["status", "review"]
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
    fn a_shorter_run_does_not_close_a_longer_fence() {
        // The inner ``` is fence *content*, so the example never expands.
        let text = "Example:\n````text\n```\n/cadencr:review\n```\n````";
        assert!(scan_references(text).is_empty());
    }

    #[test]
    fn a_different_marker_does_not_close_a_fence() {
        let text = "Example:\n```text\n~~~\n/cadencr:review\n~~~\n```";
        assert!(scan_references(text).is_empty());
    }

    #[test]
    fn a_run_with_trailing_text_does_not_close_a_fence() {
        let text = "```\n/cadencr:review\n``` still code\n";
        assert!(scan_references(text).is_empty());
    }

    #[test]
    fn references_resume_after_a_long_fence_closes() {
        let text = "````\n/cadencr:status\n````\n\nnow /cadencr:review";
        assert_eq!(scan_references(text), vec!["review"]);
    }

    #[test]
    fn an_inline_code_span_may_cross_lines() {
        let text = "Example: `literal\n/cadencr:review\nend`";
        assert!(scan_references(text).is_empty());
    }

    #[test]
    fn an_unmatched_run_does_not_disable_later_spans() {
        let text = "Example: `` unmatched then `literal /cadencr:review`";
        assert!(scan_references(text).is_empty());
    }

    #[test]
    fn references_resume_after_a_multiline_span_closes() {
        let text = "Example: `literal\nend` then /cadencr:review";
        assert_eq!(scan_references(text), vec!["review"]);
    }

    #[test]
    fn a_paragraph_break_ends_an_unclosed_span() {
        // A stray backtick must not swallow the rest of the message.
        let text = "stray ` tick\n\nthen /cadencr:review";
        assert_eq!(scan_references(text), vec!["review"]);
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
