//! Tool-name predicates and Bash output truncation helpers shared by
//! `build_blocks` and its tool-result handler. Pulled out of the original
//! `repository.rs` (>2000 lines) so that file-size and concern boundaries
//! line up.

/// Max number of lines retained in a Bash `tool_result` block on the wire.
/// Larger outputs are tail-truncated and flagged with `truncated_content`,
/// and the full content is reachable via `GET /api/sessions/messages/{id}/full`.
pub(super) const BASH_OUTPUT_MAX_LINES: usize = 200;
/// Max UTF-8 bytes retained from a Bash `tool_result` output field after line
/// truncation. This keeps pathological single-line outputs from dominating the
/// decoded agent-state payload.
const BASH_OUTPUT_MAX_CHARS: usize = 8 * 1024;

pub(super) fn is_file_change_tool_name(tool_name: Option<&str>) -> bool {
    matches!(
        tool_name,
        Some("Write" | "Edit" | "NotebookEdit" | "ApplyPatch" | "apply_patch")
    )
}

/// Cadencr persists provider tool names in their canonical form. Codex
/// normalizes `bash`/`shell`/`exec`/`exec_command` → `"Bash"` in
/// `agents/codex/raw_tool_names.rs:43`; OpenCode round-trips through
/// `canonical_cadencr_tool_name` in `agents/opencode/tool_names.rs`; Claude
/// Code already emits `"Bash"`. So a plain equality check is intentional and
/// keeps the provider-boundary rule: a single canonical name in shared code.
pub(super) fn is_bash_tool_name(tool_name: Option<&str>) -> bool {
    matches!(tool_name, Some("Bash"))
}

/// Tail-truncate Bash content to the last `max_lines` lines.
/// Returns `(content, was_truncated)`. The full output is preserved in the
/// database and exposed via `GET /api/sessions/messages/{id}/full`.
///
/// Bash command output is stored as a JSON envelope on the agent_messages
/// row (e.g. `{"aggregatedOutput":"line1\nline2\n…","status":"…",…}`), so
/// the newlines we care about are *inside* one JSON string field, not in
/// the raw bytes. Parse the envelope, truncate the embedded `aggregatedOutput`
/// (or `output` / `stdout` for older formats), and re-serialize. Fall back
/// to raw line-splitting for content that isn't a JSON object.
pub(super) fn truncate_bash_output(content: &str, max_lines: usize) -> (String, bool) {
    if content.is_empty() {
        return (String::new(), false);
    }
    if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(content) {
        if let Some(obj) = value.as_object_mut() {
            let mut envelope_was_truncated = false;
            for key in ["aggregatedOutput", "output", "stdout"] {
                let Some(serde_json::Value::String(s)) = obj.get(key).cloned() else {
                    continue;
                };
                let (truncated, was_truncated) =
                    truncate_bash_output_text(&s, max_lines, BASH_OUTPUT_MAX_CHARS);
                if !was_truncated {
                    continue;
                }
                obj.insert(key.to_string(), serde_json::Value::String(truncated));
                envelope_was_truncated = true;
            }
            return if envelope_was_truncated {
                (value.to_string(), true)
            } else {
                (content.to_owned(), false)
            };
        }
    }
    truncate_bash_output_text(content, max_lines, BASH_OUTPUT_MAX_CHARS)
}

fn truncate_bash_output_text(content: &str, max_lines: usize, max_chars: usize) -> (String, bool) {
    // Cheap fast-path: under both caps and no possibility of line trimming.
    // Avoids splitting + allocating a Vec<&str> for the common case of short
    // command output (which runs over every Bash block on every full read).
    // Count newlines with early-exit once we've seen more than `max_lines`.
    if content.len() <= max_chars {
        let mut newline_count = 0usize;
        let mut over_cap = false;
        for &b in content.as_bytes() {
            if b == b'\n' {
                newline_count += 1;
                if newline_count >= max_lines {
                    over_cap = true;
                    break;
                }
            }
        }
        if !over_cap {
            return (content.to_owned(), false);
        }
    }
    let lines: Vec<&str> = content.split('\n').collect();
    let line_truncated = lines.len() > max_lines;
    let line_limited = if line_truncated {
        lines[lines.len() - max_lines..].join("\n")
    } else {
        content.to_owned()
    };
    if line_limited.len() <= max_chars {
        return (line_limited, line_truncated);
    }
    (
        tail_by_utf8_bytes(&line_limited, max_chars).to_owned(),
        true,
    )
}

fn tail_by_utf8_bytes(content: &str, max_bytes: usize) -> &str {
    if content.len() <= max_bytes {
        return content;
    }
    let mut start = content.len() - max_bytes;
    while !content.is_char_boundary(start) {
        start += 1;
    }
    &content[start..]
}

#[cfg(test)]
mod tests {
    use super::super::blocks::build_blocks;
    use super::super::test_support::*;
    use super::*;

    // ---- is_bash_tool_name() ----

    #[test]
    fn test_is_bash_tool_name_matches_bash() {
        assert!(is_bash_tool_name(Some("Bash")));
    }

    #[test]
    fn test_is_bash_tool_name_rejects_others() {
        assert!(!is_bash_tool_name(None));
        assert!(!is_bash_tool_name(Some("")));
        assert!(!is_bash_tool_name(Some("bash"))); // case-sensitive
        assert!(!is_bash_tool_name(Some("Edit")));
        assert!(!is_bash_tool_name(Some("Write")));
        assert!(!is_bash_tool_name(Some("Task")));
    }

    // ---- truncate_bash_output() ----

    #[test]
    fn test_truncate_bash_output_empty() {
        let (out, trunc) = truncate_bash_output("", 200);
        assert_eq!(out, "");
        assert!(!trunc);
    }

    #[test]
    fn test_truncate_bash_output_no_newlines() {
        let (out, trunc) = truncate_bash_output("single line", 200);
        assert_eq!(out, "single line");
        assert!(!trunc);
    }

    #[test]
    fn test_truncate_bash_output_exactly_max_lines() {
        let content = (1..=5)
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        let (out, trunc) = truncate_bash_output(&content, 5);
        assert_eq!(out, content);
        assert!(!trunc);
    }

    #[test]
    fn test_truncate_bash_output_max_plus_one() {
        let content = (1..=6)
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        let (out, trunc) = truncate_bash_output(&content, 5);
        assert!(trunc);
        // Should retain the LAST 5 lines (drop the oldest one, "1")
        assert_eq!(out, "2\n3\n4\n5\n6");
    }

    #[test]
    fn test_truncate_bash_output_json_envelope_aggregated_output() {
        let inner = (1..=300)
            .map(|i| format!("line {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let envelope = serde_json::json!({
            "aggregatedOutput": inner,
            "processId": "12345",
            "status": "completed",
        })
        .to_string();
        let (out, trunc) = truncate_bash_output(&envelope, 200);
        assert!(
            trunc,
            "envelope with 300-line aggregatedOutput must be truncated"
        );
        let parsed: serde_json::Value = serde_json::from_str(&out).expect("re-parses");
        let truncated_inner = parsed
            .get("aggregatedOutput")
            .and_then(|v| v.as_str())
            .expect("aggregatedOutput preserved");
        assert_eq!(truncated_inner.split('\n').count(), 200);
        assert!(truncated_inner.starts_with("line 101"));
        assert!(truncated_inner.ends_with("line 300"));
        // Sibling fields preserved
        assert_eq!(
            parsed.get("processId").and_then(|v| v.as_str()),
            Some("12345")
        );
        assert_eq!(
            parsed.get("status").and_then(|v| v.as_str()),
            Some("completed")
        );
    }

    #[test]
    fn test_truncate_bash_output_json_envelope_short_aggregated_output_untouched() {
        let envelope = serde_json::json!({
            "aggregatedOutput": "hi\nthere",
            "status": "completed",
        })
        .to_string();
        let (out, trunc) = truncate_bash_output(&envelope, 200);
        assert!(!trunc);
        assert_eq!(out, envelope);
    }

    #[test]
    fn test_truncate_bash_output_json_envelope_falls_back_to_output_key() {
        let inner = (1..=250)
            .map(|i| format!("l{i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let envelope = serde_json::json!({ "output": inner }).to_string();
        let (out, trunc) = truncate_bash_output(&envelope, 100);
        assert!(trunc);
        let parsed: serde_json::Value = serde_json::from_str(&out).expect("re-parses");
        let truncated_inner = parsed.get("output").and_then(|v| v.as_str()).unwrap();
        assert_eq!(truncated_inner.split('\n').count(), 100);
        assert!(truncated_inner.ends_with("l250"));
    }

    #[test]
    fn test_truncate_bash_output_json_envelope_caps_very_long_lines() {
        let inner = (1..=5)
            .map(|i| format!("line-{i}-{}", "x".repeat(BASH_OUTPUT_MAX_CHARS)))
            .collect::<Vec<_>>()
            .join("\n");
        let envelope = serde_json::json!({ "aggregatedOutput": inner }).to_string();

        let (out, trunc) = truncate_bash_output(&envelope, BASH_OUTPUT_MAX_LINES);

        assert!(trunc);
        let parsed: serde_json::Value = serde_json::from_str(&out).expect("re-parses");
        let truncated_inner = parsed
            .get("aggregatedOutput")
            .and_then(|v| v.as_str())
            .expect("aggregatedOutput preserved");
        assert!(truncated_inner.len() <= BASH_OUTPUT_MAX_CHARS);
        assert!(truncated_inner.ends_with(&"x".repeat(BASH_OUTPUT_MAX_CHARS)));
    }

    #[test]
    fn test_truncate_bash_output_json_envelope_caps_all_output_fields() {
        let inner = (1..=5)
            .map(|i| format!("line-{i}-{}", "x".repeat(BASH_OUTPUT_MAX_CHARS)))
            .collect::<Vec<_>>()
            .join("\n");
        let envelope = serde_json::json!({
            "aggregatedOutput": inner,
            "output": inner,
            "stdout": inner,
            "status": "completed",
        })
        .to_string();

        let (out, trunc) = truncate_bash_output(&envelope, BASH_OUTPUT_MAX_LINES);

        assert!(trunc);
        let parsed: serde_json::Value = serde_json::from_str(&out).expect("re-parses");
        for key in ["aggregatedOutput", "output", "stdout"] {
            let truncated_inner = parsed.get(key).and_then(|v| v.as_str()).expect(key);
            assert!(
                truncated_inner.len() <= BASH_OUTPUT_MAX_CHARS,
                "{key} should be capped, got {} bytes",
                truncated_inner.len()
            );
        }
        assert_eq!(
            parsed.get("status").and_then(|v| v.as_str()),
            Some("completed")
        );
    }

    #[test]
    fn test_truncate_bash_output_raw_caps_very_long_lines() {
        let content = format!("short\n{}", "z".repeat(BASH_OUTPUT_MAX_CHARS + 100));

        let (out, trunc) = truncate_bash_output(&content, BASH_OUTPUT_MAX_LINES);

        assert!(trunc);
        assert!(out.len() <= BASH_OUTPUT_MAX_CHARS);
        assert_eq!(out, "z".repeat(BASH_OUTPUT_MAX_CHARS));
    }

    #[test]
    fn test_truncate_bash_output_large() {
        let content = (1..=1000)
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        let (out, trunc) = truncate_bash_output(&content, 200);
        assert!(trunc);
        let kept: Vec<&str> = out.split('\n').collect();
        assert_eq!(kept.len(), 200);
        assert_eq!(kept[0], "801");
        assert_eq!(kept[199], "1000");
    }

    // ---- Bash tool_result truncation in build_blocks ----
    // These are integration tests for the truncation hook called from
    // `handle_tool_result`. They live here (not in `tool_blocks.rs`) to keep
    // truncation behavior verified next to its implementation; the inputs
    // exercise the predicates + truncation helpers exported from this module.

    #[test]
    fn test_build_blocks_bash_result_truncated_when_oversized() {
        let big_output = (1..=BASH_OUTPUT_MAX_LINES + 50)
            .map(|i| format!("line {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let msgs = vec![
            make_message_full(
                1,
                1,
                "tool_call",
                r#"{"command":"seq"}"#,
                Some("Bash"),
                Some("tu-b"),
                None,
            ),
            make_message_full(2, 1, "tool_result", &big_output, None, Some("tu-b"), None),
        ];
        let blocks = build_blocks(&msgs);
        assert_eq!(blocks.len(), 2);
        let result = &blocks[1];
        assert_eq!(result.type_, "tool_result");
        assert_eq!(result.truncated_content, Some(true));
        let kept_lines: Vec<&str> = result.content.split('\n').collect();
        assert_eq!(kept_lines.len(), BASH_OUTPUT_MAX_LINES);
        // Bash tool_call args must be untouched (the args, not the output).
        assert_eq!(blocks[0].content, r#"{"command":"seq"}"#);
    }

    #[test]
    fn test_build_blocks_bash_result_not_truncated_when_small() {
        let small = "ok";
        let msgs = vec![
            make_message_full(
                1,
                1,
                "tool_call",
                r#"{"command":"echo"}"#,
                Some("Bash"),
                Some("tu-s"),
                None,
            ),
            make_message_full(2, 1, "tool_result", small, None, Some("tu-s"), None),
        ];
        let blocks = build_blocks(&msgs);
        assert_eq!(blocks[1].content, small);
        assert_eq!(blocks[1].truncated_content, None);
    }

    #[test]
    fn test_build_blocks_non_bash_result_not_truncated() {
        let huge = (1..=1000)
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        let msgs = vec![
            make_message_full(1, 1, "tool_call", "{}", Some("Read"), Some("tu-r"), None),
            make_message_full(2, 1, "tool_result", &huge, None, Some("tu-r"), None),
        ];
        let blocks = build_blocks(&msgs);
        assert_eq!(blocks[1].content, huge);
        assert_eq!(blocks[1].truncated_content, None);
    }
}
