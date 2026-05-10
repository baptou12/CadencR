use sqlx::SqlitePool;
use std::collections::HashMap;

use super::models::*;
use crate::error::AppError;

/// Soft cap on the total number of blocks (root + nested) returned by a single
/// `get_feature_agent_state` call. The wire payload for very long conversations
/// can dwarf the per-session message `limit` because each Bash call yields two
/// blocks (call + result) and Task agents nest children — so a message-level
/// cap is not a useful payload-size guard. When the block count exceeds this
/// value we drop the oldest root blocks (and their children) and report
/// `has_more = true` so the client can paginate with `before_message_ids`.
const BLOCK_SOFT_CAP: usize = 400;

/// Max number of lines retained in a Bash `tool_result` block on the wire.
/// Larger outputs are tail-truncated and flagged with `truncated_content`,
/// and the full content is reachable via `GET /api/sessions/messages/{id}/full`.
const BASH_OUTPUT_MAX_LINES: usize = 200;
/// Max UTF-8 bytes retained from a Bash `tool_result` output field after line
/// truncation. This keeps pathological single-line outputs from dominating the
/// decoded agent-state payload.
const BASH_OUTPUT_MAX_CHARS: usize = 8 * 1024;

// ---- Block builder (port of shared.ts buildBlocks) ----

struct MutableBlock {
    id: String,
    type_: String,
    content: String,
    tool_name: Option<String>,
    tool_use_id: Option<String>,
    parent_tool_use_id: Option<String>,
    is_error: Option<bool>,
    source_tool_name: Option<String>,
    created_at: Option<String>,
    model: Option<String>,
    has_child_slots: bool, // Task/Agent get child slots
    child_indices: Vec<usize>,
    truncated_content: Option<bool>,
}

fn convert_block(idx: usize, all: &[MutableBlock]) -> AgentBlock {
    let b = &all[idx];
    let child_blocks = if b.has_child_slots || !b.child_indices.is_empty() {
        Some(
            b.child_indices
                .iter()
                .map(|&ci| convert_block(ci, all))
                .collect(),
        )
    } else {
        None
    };
    AgentBlock {
        id: b.id.clone(),
        type_: b.type_.clone(),
        content: b.content.clone(),
        tool_name: b.tool_name.clone(),
        tool_args: if b.type_ == "tool_call" {
            Some(b.content.clone())
        } else {
            None
        },
        is_error: b.is_error,
        tool_use_id: b.tool_use_id.clone(),
        parent_tool_use_id: b.parent_tool_use_id.clone(),
        child_blocks,
        source_tool_name: b.source_tool_name.clone(),
        created_at: b.created_at.clone(),
        model: b.model.clone(),
        truncated_content: b.truncated_content,
    }
}

pub fn build_blocks(messages: &[AgentMessageRow]) -> Vec<AgentBlock> {
    let mut all: Vec<MutableBlock> = Vec::new();
    let mut tool_use_id_map: HashMap<String, usize> = HashMap::new();
    let mut root_indices: Vec<usize> = Vec::new();

    for msg in messages {
        let id = format!("msg-{}", msg.id);
        let parent_id = msg.parent_tool_use_id.as_deref();
        let parent_idx = parent_id.and_then(|pid| tool_use_id_map.get(pid).copied());

        match msg.message_type.as_str() {
            "text" | "text_delta" => {
                // Check if we should merge with last text block
                let last_idx_opt = if let Some(pidx) = parent_idx {
                    all[pidx].child_indices.last().copied()
                } else {
                    root_indices.last().copied()
                };
                let should_merge = last_idx_opt.map_or(false, |li| {
                    all[li].type_ == "text" && all[li].parent_tool_use_id.as_deref() == parent_id
                });

                if should_merge {
                    let last_idx = last_idx_opt.unwrap();
                    all[last_idx].content.push_str(&msg.content);
                } else {
                    let new_idx = all.len();
                    all.push(MutableBlock {
                        id,
                        type_: "text".to_string(),
                        content: msg.content.clone(),
                        tool_name: None,
                        tool_use_id: None,
                        parent_tool_use_id: msg.parent_tool_use_id.clone(),
                        is_error: None,
                        source_tool_name: None,
                        created_at: msg.created_at.clone(),
                        model: msg.model.clone(),
                        has_child_slots: false,
                        child_indices: Vec::new(),
                        truncated_content: None,
                    });
                    if let Some(pidx) = parent_idx {
                        all[pidx].child_indices.push(new_idx);
                    } else {
                        root_indices.push(new_idx);
                    }
                }
            }
            "thinking" | "thinking_delta" => {
                let last_idx_opt = if let Some(pidx) = parent_idx {
                    all[pidx].child_indices.last().copied()
                } else {
                    root_indices.last().copied()
                };
                let should_merge = last_idx_opt.map_or(false, |li| {
                    all[li].type_ == "thinking"
                        && all[li].parent_tool_use_id.as_deref() == parent_id
                });

                if should_merge {
                    let last_idx = last_idx_opt.unwrap();
                    all[last_idx].content.push_str(&msg.content);
                } else {
                    let new_idx = all.len();
                    all.push(MutableBlock {
                        id,
                        type_: "thinking".to_string(),
                        content: msg.content.clone(),
                        tool_name: None,
                        tool_use_id: None,
                        parent_tool_use_id: msg.parent_tool_use_id.clone(),
                        is_error: None,
                        source_tool_name: None,
                        created_at: msg.created_at.clone(),
                        model: None,
                        has_child_slots: false,
                        child_indices: Vec::new(),
                        truncated_content: None,
                    });
                    if let Some(pidx) = parent_idx {
                        all[pidx].child_indices.push(new_idx);
                    } else {
                        root_indices.push(new_idx);
                    }
                }
            }
            "tool_call" => {
                // Deduplicate: if tool_use_id already seen, update content if longer.
                // Exception: Bash tool_calls must keep their original args content
                // (e.g. {"command":..., "description":...}) — without this guard,
                // a stray duplicate row carrying the bash OUTPUT would overwrite
                // the args here, doubling the payload (the same output already
                // lives on the matching `tool_result` block).
                if let Some(tuid) = &msg.tool_use_id {
                    if let Some(&existing_idx) = tool_use_id_map.get(tuid.as_str()) {
                        if !is_bash_tool_name(all[existing_idx].tool_name.as_deref())
                            && !msg.content.is_empty()
                            && msg.content.len() > all[existing_idx].content.len()
                        {
                            all[existing_idx].content = msg.content.clone();
                        }
                        continue;
                    }
                }

                let is_task = msg.tool_name.as_deref() == Some("Task")
                    || msg.tool_name.as_deref() == Some("Agent");
                // Defensive truncation for Bash tool_calls. The dedup gate
                // above prevents *new* rows from poisoning the tool_call with
                // command output, but historical rows in the DB already carry
                // the full output baked onto the tool_call. Treat the content
                // exactly like a Bash tool_result so the wire stays small.
                let is_bash_call = is_bash_tool_name(msg.tool_name.as_deref());
                let (call_content, call_truncated) = if is_bash_call {
                    truncate_bash_output(&msg.content, BASH_OUTPUT_MAX_LINES)
                } else {
                    (msg.content.clone(), false)
                };
                let new_idx = all.len();
                all.push(MutableBlock {
                    id,
                    type_: "tool_call".to_string(),
                    content: call_content,
                    tool_name: msg.tool_name.clone().or(Some("tool".to_string())),
                    tool_use_id: msg.tool_use_id.clone(),
                    parent_tool_use_id: msg.parent_tool_use_id.clone(),
                    is_error: None,
                    source_tool_name: None,
                    created_at: msg.created_at.clone(),
                    model: None,
                    has_child_slots: is_task,
                    child_indices: Vec::new(),
                    truncated_content: if call_truncated { Some(true) } else { None },
                });
                if let Some(tuid) = &msg.tool_use_id {
                    tool_use_id_map.insert(tuid.clone(), new_idx);
                }
                if let Some(pidx) = parent_idx {
                    all[pidx].child_indices.push(new_idx);
                } else {
                    root_indices.push(new_idx);
                }
            }
            "tool_result" | "tool_error" => {
                let is_error = msg.message_type == "tool_error";
                // Resolve source tool name
                let source_tool_name = msg
                    .tool_use_id
                    .as_deref()
                    .and_then(|tuid| tool_use_id_map.get(tuid))
                    .and_then(|&idx| all[idx].tool_name.clone())
                    .or_else(|| {
                        // Fallback: scan backwards for last tool_call in list
                        let list = if let Some(pidx) = parent_idx {
                            &all[pidx].child_indices as &[usize]
                        } else {
                            &root_indices
                        };
                        list.iter()
                            .rev()
                            .find(|&&li| all[li].type_ == "tool_call")
                            .and_then(|&li| all[li].tool_name.clone())
                    });

                if let Some(tuid) = msg.tool_use_id.as_deref() {
                    if let Some(&tool_idx) = tool_use_id_map.get(tuid) {
                        if is_file_change_tool_name(all[tool_idx].tool_name.as_deref()) {
                            merge_tool_result_patch(&mut all[tool_idx].content, &msg.content);
                        }
                    }
                }

                // Truncate Bash tool_result payloads to the last N lines on the
                // wire. The full output remains in `agent_messages.content` and
                // is reachable via `GET /api/sessions/messages/{id}/full`.
                let is_bash_result = is_bash_tool_name(source_tool_name.as_deref());
                let (result_content, was_truncated) = if is_bash_result {
                    truncate_bash_output(&msg.content, BASH_OUTPUT_MAX_LINES)
                } else {
                    (msg.content.clone(), false)
                };

                let new_idx = all.len();
                all.push(MutableBlock {
                    id,
                    type_: "tool_result".to_string(),
                    content: result_content,
                    tool_name: None,
                    tool_use_id: msg.tool_use_id.clone(),
                    parent_tool_use_id: msg.parent_tool_use_id.clone(),
                    is_error: Some(is_error),
                    source_tool_name,
                    created_at: msg.created_at.clone(),
                    model: None,
                    has_child_slots: false,
                    child_indices: Vec::new(),
                    truncated_content: if was_truncated { Some(true) } else { None },
                });
                // Nest under parent_tool_use_id if available, otherwise under the
                // matching Agent/Task tool_call (tool_result shares tool_use_id).
                let nest_idx = parent_idx.or_else(|| {
                    msg.tool_use_id
                        .as_deref()
                        .and_then(|tuid| tool_use_id_map.get(tuid).copied())
                        .filter(|&idx| all[idx].has_child_slots)
                });
                if let Some(pidx) = nest_idx {
                    all[pidx].child_indices.push(new_idx);
                } else {
                    root_indices.push(new_idx);
                }
            }
            "user_message" => {
                let new_idx = all.len();
                all.push(MutableBlock {
                    id,
                    type_: "user_message".to_string(),
                    content: msg.content.clone(),
                    tool_name: None,
                    tool_use_id: None,
                    parent_tool_use_id: msg.parent_tool_use_id.clone(),
                    is_error: None,
                    source_tool_name: None,
                    created_at: msg.created_at.clone(),
                    model: None,
                    has_child_slots: false,
                    child_indices: Vec::new(),
                    truncated_content: None,
                });
                if let Some(pidx) = parent_idx {
                    all[pidx].child_indices.push(new_idx);
                } else {
                    root_indices.push(new_idx);
                }
            }
            "error" => {
                let new_idx = all.len();
                all.push(MutableBlock {
                    id,
                    type_: "text".to_string(),
                    content: format!("Error: {}", msg.content),
                    tool_name: None,
                    tool_use_id: None,
                    parent_tool_use_id: msg.parent_tool_use_id.clone(),
                    is_error: Some(true),
                    source_tool_name: None,
                    created_at: None,
                    model: None,
                    has_child_slots: false,
                    child_indices: Vec::new(),
                    truncated_content: None,
                });
                if let Some(pidx) = parent_idx {
                    all[pidx].child_indices.push(new_idx);
                } else {
                    root_indices.push(new_idx);
                }
            }
            "compact_divider" => {
                let new_idx = all.len();
                all.push(MutableBlock {
                    id,
                    type_: "compact_divider".to_string(),
                    content: msg.content.clone(),
                    tool_name: None,
                    tool_use_id: None,
                    parent_tool_use_id: msg.parent_tool_use_id.clone(),
                    is_error: None,
                    source_tool_name: None,
                    created_at: None,
                    model: None,
                    has_child_slots: false,
                    child_indices: Vec::new(),
                    truncated_content: None,
                });
                if let Some(pidx) = parent_idx {
                    all[pidx].child_indices.push(new_idx);
                } else {
                    root_indices.push(new_idx);
                }
            }
            "clear_divider" => {
                let new_idx = all.len();
                all.push(MutableBlock {
                    id,
                    type_: "clear_divider".to_string(),
                    content: String::new(),
                    tool_name: None,
                    tool_use_id: None,
                    parent_tool_use_id: msg.parent_tool_use_id.clone(),
                    is_error: None,
                    source_tool_name: None,
                    created_at: None,
                    model: None,
                    has_child_slots: false,
                    child_indices: Vec::new(),
                    truncated_content: None,
                });
                if let Some(pidx) = parent_idx {
                    all[pidx].child_indices.push(new_idx);
                } else {
                    root_indices.push(new_idx);
                }
            }
            _ => {}
        }
    }

    root_indices
        .iter()
        .map(|&idx| convert_block(idx, &all))
        .collect()
}

fn is_file_change_tool_name(tool_name: Option<&str>) -> bool {
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
fn is_bash_tool_name(tool_name: Option<&str>) -> bool {
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
fn truncate_bash_output(content: &str, max_lines: usize) -> (String, bool) {
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

/// Count root + nested blocks (one level of `child_blocks`).
fn total_block_count(blocks: &[AgentBlock]) -> usize {
    blocks
        .iter()
        .map(|b| 1 + b.child_blocks.as_ref().map_or(0, |c| c.len()))
        .sum()
}

/// Extract the numeric message id encoded in `AgentBlock::id` (`"msg-<n>"`).
fn block_message_id(block: &AgentBlock) -> Option<i64> {
    block.id.strip_prefix("msg-").and_then(|s| s.parse().ok())
}

/// Drop the oldest root blocks (and their nested children) until the total
/// block count is at or below `cap`. Returns the number of root blocks that
/// were dropped. A caller should mark `has_more = true` and recompute the
/// oldest cursor when this is non-zero.
fn trim_blocks_to_cap(blocks: &mut Vec<AgentBlock>, cap: usize) -> usize {
    let total = total_block_count(blocks);
    if total <= cap {
        return 0;
    }
    // Scan front-to-back accumulating child counts; stop as soon as dropping
    // up to `i` root entries would put us at or below the cap. Single O(n)
    // pass plus one `drain` — no quadratic recount or per-element memmove.
    let mut remaining = total;
    let mut dropped = 0usize;
    for block in blocks.iter() {
        if remaining <= cap {
            break;
        }
        remaining -= 1 + block.child_blocks.as_ref().map_or(0, |c| c.len());
        dropped += 1;
    }
    blocks.drain(0..dropped);
    dropped
}

fn merge_tool_result_patch(tool_call_content: &mut String, tool_result_content: &str) {
    let Ok(result) = serde_json::from_str::<serde_json::Value>(tool_result_content) else {
        return;
    };
    let Some(result_object) = result.as_object() else {
        return;
    };
    if !result_object.contains_key("patch_text") {
        return;
    }
    let mut base = serde_json::from_str::<serde_json::Value>(tool_call_content)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    for (key, value) in result_object {
        base.entry(key.clone()).or_insert_with(|| value.clone());
    }
    if let Ok(content) = serde_json::to_string(&serde_json::Value::Object(base)) {
        *tool_call_content = content;
    }
}

// ---- Helpers ----

/// Fetch parent Agent/Task tool_call rows that are referenced by children in the
/// given message page but not already present. This lets `build_blocks` correctly
/// nest sub-agent children even when pagination splits parent from children.
async fn fetch_missing_parents(
    pool: &SqlitePool,
    session_id: i64,
    msgs: &[AgentMessageRow],
) -> Result<Vec<AgentMessageRow>, AppError> {
    use std::collections::HashSet;

    // Collect tool_use_ids of tool_call rows in this page
    let tool_call_tuids: HashSet<&str> = msgs
        .iter()
        .filter(|m| m.message_type == "tool_call")
        .filter_map(|m| m.tool_use_id.as_deref())
        .collect();

    let mut missing_tool_use_ids: HashSet<&str> = HashSet::new();

    for m in msgs {
        // Children whose parent_tool_use_id references a tool_call not in this page
        if let Some(ptuid) = m.parent_tool_use_id.as_deref() {
            if !tool_call_tuids.contains(ptuid) {
                missing_tool_use_ids.insert(ptuid);
            }
        // tool_results whose tool_use_id has no matching tool_call in this page
        // (build_blocks nests these via tool_use_id fallback)
        } else if m.message_type == "tool_result" || m.message_type == "tool_error" {
            if let Some(tuid) = m.tool_use_id.as_deref() {
                if !tool_call_tuids.contains(tuid) {
                    missing_tool_use_ids.insert(tuid);
                }
            }
        }
    }

    let missing: Vec<&str> = missing_tool_use_ids.into_iter().collect();

    if missing.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders = missing.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT id, session_id, content, message_type, tool_name, tool_use_id, parent_tool_use_id, created_at, model \
         FROM agent_messages WHERE session_id = ? AND message_type = 'tool_call' AND tool_use_id IN ({}) ORDER BY id ASC",
        placeholders
    );
    let mut q = sqlx::query_as::<_, AgentMessageRow>(&sql).bind(session_id);
    for tuid in &missing {
        q = q.bind(tuid);
    }
    Ok(q.fetch_all(pool).await?)
}

// ---- Repository functions ----

pub async fn get_sessions(
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<Vec<AgentSessionRow>, AppError> {
    let rows = sqlx::query_as::<_, AgentSessionRow>(
        r#"SELECT id, feature_id, agent_type, runtime_provider, runtime_session_id, status, started_at, ended_at,
           run_id, phase_id, subprocess_id, model, pending_questions, has_file_changes,
           permission_mode, pending_plan_approval, pending_prd_approval, pending_permission,
           input_tokens, output_tokens, context_window, was_compacted, draft_prompt
           FROM agent_sessions WHERE feature_id = ? ORDER BY id DESC"#,
    )
    .bind(feature_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get_feature_agent_state(
    pool: &SqlitePool,
    feature_id: i64,
    after_message_ids: Option<HashMap<i64, i64>>,
    limit: Option<i64>,
    before_message_ids: Option<HashMap<i64, i64>>,
) -> Result<FeatureAgentStateResponse, AppError> {
    let sessions = sqlx::query_as::<_, AgentSessionRow>(
        r#"SELECT id, feature_id, agent_type, runtime_provider, runtime_session_id, status, started_at, ended_at,
           run_id, phase_id, subprocess_id, model, pending_questions, has_file_changes,
           permission_mode, pending_plan_approval, pending_prd_approval, pending_permission,
           input_tokens, output_tokens, context_window, was_compacted, draft_prompt
           FROM agent_sessions WHERE feature_id = ? ORDER BY id ASC"#,
    )
    .bind(feature_id)
    .fetch_all(pool)
    .await?;

    if sessions.is_empty() {
        return Ok(FeatureAgentStateResponse { sessions: vec![] });
    }

    // Batch-fetch phase titles for sessions that have a phase_id
    let phase_ids: Vec<i64> = sessions
        .iter()
        .filter_map(|s| s.phase_id)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    let mut phase_title_map: HashMap<i64, String> = HashMap::new();
    if !phase_ids.is_empty() {
        // Build dynamic IN clause
        let placeholders = phase_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT id, title FROM phases WHERE id IN ({})",
            placeholders
        );
        let mut q = sqlx::query_as::<_, PhaseTitle>(&sql);
        for pid in &phase_ids {
            q = q.bind(pid);
        }
        let phase_rows = q.fetch_all(pool).await?;
        for p in phase_rows {
            phase_title_map.insert(p.id, p.title);
        }
    }

    let after_map = after_message_ids.unwrap_or_default();

    // Split sessions into full-fetch vs incremental
    let mut full_fetch_ids: Vec<i64> = Vec::new();
    let mut incremental_fetches: Vec<(i64, i64)> = Vec::new(); // (session_id, after_id)

    for s in &sessions {
        if let Some(&after_id) = after_map.get(&s.id) {
            if after_id > 0 {
                incremental_fetches.push((s.id, after_id));
            } else {
                full_fetch_ids.push(s.id);
            }
        } else {
            full_fetch_ids.push(s.id);
        }
    }

    let before_map = before_message_ids.unwrap_or_default();

    // Batch-fetch messages for full-fetch sessions
    let mut full_messages: HashMap<i64, Vec<AgentMessageRow>> = HashMap::new();
    // Track whether each session has older messages beyond what was fetched
    let mut has_more_map: HashMap<i64, bool> = HashMap::new();
    let mut oldest_message_id_map: HashMap<i64, i64> = HashMap::new();
    if !full_fetch_ids.is_empty() {
        if limit.is_some() || !before_map.is_empty() {
            // Per-session paginated fetch: latest N messages (or before a cursor)
            let msg_limit = limit.unwrap_or(i64::MAX);
            for sid in &full_fetch_ids {
                let mut q = if let Some(&before_id) = before_map.get(sid) {
                    sqlx::query_as::<_, AgentMessageRow>(
                        "SELECT id, session_id, content, message_type, tool_name, tool_use_id, parent_tool_use_id, created_at, model FROM agent_messages WHERE session_id = ? AND id < ? ORDER BY id DESC LIMIT ?",
                    )
                    .bind(sid)
                    .bind(before_id)
                } else {
                    sqlx::query_as::<_, AgentMessageRow>(
                        "SELECT id, session_id, content, message_type, tool_name, tool_use_id, parent_tool_use_id, created_at, model FROM agent_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?",
                    )
                    .bind(sid)
                };
                // Fetch limit+1 to detect has_more
                q = q.bind(msg_limit + 1);
                let mut msgs = q.fetch_all(pool).await?;
                let has_more = msgs.len() as i64 > msg_limit;
                if has_more {
                    msgs.truncate(msg_limit as usize);
                }
                // Reverse to restore ASC order for block building
                msgs.reverse();
                if let Some(oldest_message_id) = msgs.first().map(|m| m.id) {
                    oldest_message_id_map.insert(*sid, oldest_message_id);
                }

                // Fetch parent Agent/Task tool_call rows referenced by children
                // in this page but not already present, so build_blocks can nest them.
                let parent_msgs = fetch_missing_parents(pool, *sid, &msgs).await?;
                if !parent_msgs.is_empty() {
                    // Merge parents at the front (they have lower IDs)
                    let mut merged = parent_msgs;
                    merged.append(&mut msgs);
                    msgs = merged;
                }

                has_more_map.insert(*sid, has_more);
                full_messages.insert(*sid, msgs);
            }
        } else {
            // Unbounded batch fetch (no limit) — original fast path
            let placeholders = full_fetch_ids
                .iter()
                .map(|_| "?")
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT id, session_id, content, message_type, tool_name, tool_use_id, parent_tool_use_id, created_at, model FROM agent_messages WHERE session_id IN ({}) ORDER BY id ASC",
                placeholders
            );
            let mut q = sqlx::query_as::<_, AgentMessageRow>(&sql);
            for sid in &full_fetch_ids {
                q = q.bind(sid);
            }
            let msgs = q.fetch_all(pool).await?;
            for msg in msgs {
                full_messages.entry(msg.session_id).or_default().push(msg);
            }
        }
    }

    // OpenCode HTTP-server hydration used to run here. Removed with the
    // legacy HTTP transport: ACP sessions are subprocess-scoped and
    // there's no remote server to query for child-session messages once
    // the session ends. If parent/child relationships need to be
    // recovered post-shutdown for ACP, add a database-backed hydration
    // path here — do not bring back an HTTP fetch.

    // Incremental fetches
    let mut incremental_messages: HashMap<i64, Vec<AgentMessageRow>> = HashMap::new();
    let mut updated_tool_calls: HashMap<i64, HashMap<i64, String>> = HashMap::new();

    for (sid, after_id) in &incremental_fetches {
        let msgs = sqlx::query_as::<_, AgentMessageRow>(
            "SELECT id, session_id, content, message_type, tool_name, tool_use_id, parent_tool_use_id, created_at, model FROM agent_messages WHERE session_id = ? AND id > ? ORDER BY id ASC",
        )
        .bind(sid)
        .bind(after_id)
        .fetch_all(pool)
        .await?;
        incremental_messages.insert(*sid, msgs);

        // Re-fetch stale tool_call rows
        let stale = sqlx::query_as::<_, AgentMessageRow>(
            "SELECT id, session_id, content, message_type, tool_name, tool_use_id, parent_tool_use_id, created_at, model FROM agent_messages WHERE session_id = ? AND id <= ? AND message_type = 'tool_call' AND content != '{}' ORDER BY id ASC",
        )
        .bind(sid)
        .bind(after_id)
        .fetch_all(pool)
        .await?;
        if !stale.is_empty() {
            let map: HashMap<i64, String> = stale.into_iter().map(|r| (r.id, r.content)).collect();
            updated_tool_calls.insert(*sid, map);
        }
    }

    // Extract todos for incremental sessions
    let mut todos_by_session: HashMap<i64, Vec<serde_json::Value>> = HashMap::new();
    for (sid, _) in &incremental_fetches {
        let row = sqlx::query_as::<_, AgentMessageRow>(
            "SELECT id, session_id, content, message_type, tool_name, tool_use_id, parent_tool_use_id, created_at, model FROM agent_messages WHERE session_id = ? AND message_type = 'tool_call' AND tool_name = 'TodoWrite' ORDER BY id DESC LIMIT 1",
        )
        .bind(sid)
        .fetch_optional(pool)
        .await?;
        if let Some(row) = row {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&row.content) {
                if let Some(todos) = parsed.get("todos").and_then(|t| t.as_array()) {
                    todos_by_session.insert(*sid, todos.clone());
                }
            }
        }
    }

    // Build session states
    let session_states: Vec<SessionState> = sessions
        .into_iter()
        .map(|s| {
            let is_incremental = incremental_messages.contains_key(&s.id);
            let msgs = if is_incremental {
                incremental_messages.get(&s.id).cloned().unwrap_or_default()
            } else {
                full_messages.get(&s.id).cloned().unwrap_or_default()
            };

            // Extract todos for full-fetch sessions
            if !is_incremental {
                for msg in msgs.iter().rev() {
                    if msg.message_type == "tool_call"
                        && msg.tool_name.as_deref() == Some("TodoWrite")
                    {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&msg.content)
                        {
                            if let Some(todos) = parsed.get("todos").and_then(|t| t.as_array()) {
                                todos_by_session.insert(s.id, todos.clone());
                            }
                        }
                        break;
                    }
                }
            }

            let max_message_id = if is_incremental {
                let new_max = msgs.iter().map(|m| m.id).max().unwrap_or(0);
                if new_max > 0 {
                    new_max
                } else {
                    after_map.get(&s.id).copied().unwrap_or(0)
                }
            } else {
                msgs.iter().map(|m| m.id).max().unwrap_or(0)
            };

            let mut blocks = build_blocks(&msgs);

            // Block-level pagination soft cap (full-fetch only). The
            // per-session message `limit` is on `agent_messages` rows, but
            // payload size scales with BLOCKS (every Bash call expands to two
            // blocks plus output). Drop the oldest root blocks until we are
            // under the cap and report has_more so the client can paginate.
            let mut trimmed_has_more = false;
            let mut trimmed_oldest_id: Option<i64> = None;
            if !is_incremental {
                let dropped = trim_blocks_to_cap(&mut blocks, BLOCK_SOFT_CAP);
                if dropped > 0 {
                    trimmed_has_more = true;
                    trimmed_oldest_id = blocks.iter().filter_map(block_message_id).min();
                }
            }

            let tool_call_updates: Option<HashMap<String, String>> = if is_incremental {
                updated_tool_calls.get(&s.id).map(|m| {
                    m.iter()
                        .map(|(id, content)| (format!("msg-{}", id), content.clone()))
                        .collect()
                })
            } else {
                None
            };

            let pending_questions = s
                .pending_questions
                .as_deref()
                .and_then(|pq| serde_json::from_str(pq).ok());
            let pending_plan_approval = s
                .pending_plan_approval
                .as_deref()
                .and_then(|p| serde_json::from_str(p).ok());
            let pending_prd_approval = s
                .pending_prd_approval
                .as_deref()
                .and_then(|p| serde_json::from_str(p).ok());
            let pending_permission = s
                .pending_permission
                .as_deref()
                .and_then(|p| serde_json::from_str(p).ok());

            let resumable =
                (s.status == "paused" || s.status == "completed" || s.status == "error")
                    && s.runtime_session_id.is_some();

            SessionState {
                session_db_id: s.id,
                agent_type: s.agent_type,
                status: s.status,
                subprocess_id: s.subprocess_id,
                model: s.model,
                blocks,
                max_message_id,
                is_incremental,
                tool_call_updates,
                pending_questions,
                has_file_changes: s.has_file_changes != 0,
                resumable,
                runtime_provider: s.runtime_provider,
                runtime_session_id: s.runtime_session_id,
                run_id: s.run_id,
                phase_id: s.phase_id,
                phase_title: s
                    .phase_id
                    .and_then(|pid| phase_title_map.get(&pid).cloned()),
                todos: todos_by_session.get(&s.id).cloned(),
                permission_mode: s
                    .permission_mode
                    .unwrap_or_else(|| "acceptEdits".to_string()),
                pending_plan_approval,
                pending_prd_approval,
                pending_permission,
                input_tokens: s.input_tokens.unwrap_or(0),
                output_tokens: s.output_tokens.unwrap_or(0),
                context_window: s.context_window,
                was_compacted: s.was_compacted != 0,
                draft_prompt: s.draft_prompt,
                has_more: *has_more_map.get(&s.id).unwrap_or(&false) || trimmed_has_more,
                oldest_message_id: trimmed_oldest_id.or_else(|| {
                    oldest_message_id_map
                        .get(&s.id)
                        .copied()
                        .or_else(|| msgs.first().map(|m| m.id))
                }),
            }
        })
        .collect();

    Ok(FeatureAgentStateResponse {
        sessions: session_states,
    })
}

/// Per-session live status snapshot used by the WS subscribe handler to
/// hydrate (re)connecting clients. The result is keyed by `session_id`
/// (stringified for JSON-friendly serialization). Each entry is the full
/// derived [`SessionStatusEntry`] minus `seq` — the snapshot wraps these
/// with the broadcaster's `current_seq()` at the moment of subscription.
///
/// Includes `status='paused'` rows that have a pending-input column set —
/// a workflow agent awaiting user input is persisted as `paused` but must
/// surface as Question. Plain-paused rows (no pending column) are excluded
/// so they don't resurrect as a fake "agent" turn.
pub async fn get_session_status_snapshot(
    pool: &SqlitePool,
) -> Result<HashMap<String, SessionStatusSnapshotEntry>, AppError> {
    let rows = sqlx::query_as::<_, SessionStatusSnapshotRow>(
        r#"SELECT id AS session_id,
                  feature_id,
                  status,
                  pending_permission IS NOT NULL AS pending_permission,
                  pending_questions IS NOT NULL AS pending_question,
                  pending_plan_approval IS NOT NULL AS pending_plan_approval,
                  pending_prd_approval IS NOT NULL AS pending_prd_approval
           FROM agent_sessions
           WHERE status = 'running'
              OR pending_questions IS NOT NULL
              OR pending_permission IS NOT NULL
              OR pending_plan_approval IS NOT NULL
              OR pending_prd_approval IS NOT NULL"#,
    )
    .fetch_all(pool)
    .await?;

    let mut result = HashMap::new();
    for row in rows {
        let (status, kind) = crate::domain::session_status::derive_status_from_db(
            crate::domain::session_status::DbStatusInputs {
                status_col: &row.status,
                pending_permission: row.pending_permission,
                pending_question: row.pending_question,
                pending_plan_approval: row.pending_plan_approval,
                pending_prd_approval: row.pending_prd_approval,
            },
        );
        // Idle entries get filtered: a snapshot only carries sessions
        // actively driving the UI. A session with `status='running'` and no
        // pending column is Agent; one with a pending column is Question;
        // an Idle slip-through here would just bloat the payload.
        if status == crate::domain::session_status::AgentStatus::Idle {
            continue;
        }
        result.insert(
            row.session_id.to_string(),
            SessionStatusSnapshotEntry {
                session_id: row.session_id,
                feature_id: row.feature_id,
                status,
                kind,
            },
        );
    }
    Ok(result)
}

pub async fn get_draft(pool: &SqlitePool, session_id: i64) -> Result<Option<String>, AppError> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT draft_prompt FROM agent_sessions WHERE id = ?")
            .bind(session_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.and_then(|(v,)| v))
}

/// Fetch the full, untruncated `content` for a single `agent_messages` row.
/// Used by the "Show all" affordance on Bash blocks whose payload was
/// tail-truncated for the agent-state response.
pub async fn get_message_content(
    pool: &SqlitePool,
    message_id: i64,
) -> Result<Option<String>, AppError> {
    let row: Option<(String,)> = sqlx::query_as("SELECT content FROM agent_messages WHERE id = ?")
        .bind(message_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|(c,)| c))
}

pub async fn save_draft(
    pool: &SqlitePool,
    session_id: i64,
    draft: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query("UPDATE agent_sessions SET draft_prompt = ? WHERE id = ?")
        .bind(draft)
        .bind(session_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .expect("Failed to create in-memory SQLite pool");

        sqlx::query(
            r#"CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                path TEXT NOT NULL DEFAULT ''
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"CREATE TABLE IF NOT EXISTS features (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL DEFAULT 1,
                title TEXT NOT NULL DEFAULT 'test feature'
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"CREATE TABLE IF NOT EXISTS plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                feature_id INTEGER NOT NULL
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"CREATE TABLE IF NOT EXISTS phases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_id INTEGER NOT NULL DEFAULT 1,
                title TEXT NOT NULL DEFAULT ''
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"CREATE TABLE IF NOT EXISTS agent_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                feature_id INTEGER NOT NULL,
                agent_type TEXT NOT NULL DEFAULT 'main',
                runtime_provider TEXT,
                runtime_session_id TEXT,
                status TEXT NOT NULL DEFAULT 'running',
                started_at TEXT,
                ended_at TEXT,
                run_id INTEGER,
                phase_id INTEGER,
                subprocess_id TEXT,
                model TEXT,
                pending_questions TEXT,
                has_file_changes INTEGER NOT NULL DEFAULT 0,
                permission_mode TEXT,
                pending_plan_approval TEXT,
                pending_prd_approval TEXT,
                pending_permission TEXT,
                input_tokens INTEGER,
                output_tokens INTEGER,
                context_window INTEGER,
                was_compacted INTEGER NOT NULL DEFAULT 0,
                draft_prompt TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"CREATE TABLE IF NOT EXISTS agent_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                message_type TEXT NOT NULL DEFAULT 'text',
                tool_name TEXT,
                tool_use_id TEXT,
                parent_tool_use_id TEXT,
                created_at TEXT,
                model TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        pool
    }

    async fn insert_session(pool: &SqlitePool, feature_id: i64, status: &str) -> i64 {
        let row: (i64,) = sqlx::query_as(
            "INSERT INTO agent_sessions (feature_id, agent_type, status) VALUES (?, 'main', ?) RETURNING id",
        )
        .bind(feature_id)
        .bind(status)
        .fetch_one(pool)
        .await
        .unwrap();
        row.0
    }

    async fn insert_message(
        pool: &SqlitePool,
        session_id: i64,
        message_type: &str,
        content: &str,
        tool_name: Option<&str>,
        tool_use_id: Option<&str>,
        parent_tool_use_id: Option<&str>,
    ) -> i64 {
        let row: (i64,) = sqlx::query_as(
            "INSERT INTO agent_messages (session_id, message_type, content, tool_name, tool_use_id, parent_tool_use_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(session_id)
        .bind(message_type)
        .bind(content)
        .bind(tool_name)
        .bind(tool_use_id)
        .bind(parent_tool_use_id)
        .fetch_one(pool)
        .await
        .unwrap();
        row.0
    }

    fn make_message(
        id: i64,
        session_id: i64,
        message_type: &str,
        content: &str,
    ) -> AgentMessageRow {
        AgentMessageRow {
            id,
            session_id,
            message_type: message_type.to_string(),
            content: content.to_string(),
            tool_name: None,
            tool_use_id: None,
            parent_tool_use_id: None,
            created_at: None,
            model: None,
        }
    }

    fn make_message_full(
        id: i64,
        session_id: i64,
        message_type: &str,
        content: &str,
        tool_name: Option<&str>,
        tool_use_id: Option<&str>,
        parent_tool_use_id: Option<&str>,
    ) -> AgentMessageRow {
        AgentMessageRow {
            id,
            session_id,
            message_type: message_type.to_string(),
            content: content.to_string(),
            tool_name: tool_name.map(|s| s.to_string()),
            tool_use_id: tool_use_id.map(|s| s.to_string()),
            parent_tool_use_id: parent_tool_use_id.map(|s| s.to_string()),
            created_at: None,
            model: None,
        }
    }

    // ---- build_blocks() tests ----

    #[test]
    fn test_build_blocks_empty() {
        let blocks = build_blocks(&[]);
        assert!(blocks.is_empty());
    }

    #[test]
    fn test_build_blocks_single_text() {
        let msgs = vec![make_message(1, 1, "text", "hello world")];
        let blocks = build_blocks(&msgs);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].type_, "text");
        assert_eq!(blocks[0].content, "hello world");
    }

    #[test]
    fn test_build_blocks_text_merging() {
        let msgs = vec![
            make_message(1, 1, "text", "hello"),
            make_message(2, 1, "text", " world"),
        ];
        let blocks = build_blocks(&msgs);
        assert_eq!(blocks.len(), 1, "consecutive text blocks should merge");
        assert_eq!(blocks[0].content, "hello world");
    }

    #[test]
    fn test_build_blocks_thinking_merging() {
        let msgs = vec![
            make_message(1, 1, "thinking", "first thought"),
            make_message(2, 1, "thinking", " second thought"),
        ];
        let blocks = build_blocks(&msgs);
        assert_eq!(blocks.len(), 1, "consecutive thinking blocks should merge");
        assert_eq!(blocks[0].type_, "thinking");
        assert_eq!(blocks[0].content, "first thought second thought");
    }

    #[test]
    fn test_build_blocks_tool_call_with_result() {
        let msgs = vec![
            make_message_full(1, 1, "tool_call", "{}", Some("Bash"), Some("tu-1"), None),
            make_message_full(2, 1, "tool_result", "output", None, Some("tu-1"), None),
        ];
        let blocks = build_blocks(&msgs);
        // tool_result should be a root block (not nested under tool_call unless parent_tool_use_id set)
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].type_, "tool_call");
        assert_eq!(blocks[1].type_, "tool_result");
        assert_eq!(blocks[1].source_tool_name.as_deref(), Some("Bash"));
    }

    #[test]
    fn test_build_blocks_recovers_file_change_patch_from_result() {
        let msgs = vec![
            make_message_full(
                1,
                1,
                "tool_call",
                r#"{"output":"Success"}"#,
                Some("ApplyPatch"),
                Some("patch-1"),
                None,
            ),
            make_message_full(
                2,
                1,
                "tool_result",
                r#"{"patch_text":"*** Begin Patch\n*** Update File: toto.txt\n@@\n-old\n+new\n*** End Patch","status":"completed"}"#,
                None,
                Some("patch-1"),
                None,
            ),
        ];

        let blocks = build_blocks(&msgs);
        assert_eq!(blocks[0].type_, "tool_call");
        let content: serde_json::Value = serde_json::from_str(&blocks[0].content).unwrap();
        assert_eq!(content["output"], "Success");
        assert_eq!(
            content["patch_text"],
            "*** Begin Patch\n*** Update File: toto.txt\n@@\n-old\n+new\n*** End Patch"
        );
    }

    #[test]
    fn test_build_blocks_tool_call_deduplication() {
        // Non-Bash tools (Edit/Write) legitimately accumulate args via
        // `input_json_delta`, so the longer content should win.
        let msgs = vec![
            make_message_full(1, 1, "tool_call", "{}", Some("Edit"), Some("tu-dup"), None),
            make_message_full(
                2,
                1,
                "tool_call",
                "{\"file_path\":\"/x.txt\"}",
                Some("Edit"),
                Some("tu-dup"),
                None,
            ),
        ];
        let blocks = build_blocks(&msgs);
        assert_eq!(blocks.len(), 1, "duplicate tool_use_id should deduplicate");
        assert_eq!(blocks[0].type_, "tool_call");
        // content updated to longer version
        assert_eq!(blocks[0].content, "{\"file_path\":\"/x.txt\"}");
    }

    #[test]
    fn test_build_blocks_bash_dedupe_does_not_overwrite_args() {
        // Bash tool_call args must never be replaced by a later same-tool_use_id
        // row carrying the bash OUTPUT — that's the 2x-payload regression the
        // dedupe gate prevents. The output stays exclusively on tool_result.
        let original_args = r#"{"command":"ls -la","description":"list files"}"#;
        let giant_output = "A".repeat(1_000_000);
        let msgs = vec![
            make_message_full(
                1,
                1,
                "tool_call",
                original_args,
                Some("Bash"),
                Some("tu-bash"),
                None,
            ),
            // Stray duplicate with a much longer payload — must be ignored.
            make_message_full(
                2,
                1,
                "tool_call",
                &giant_output,
                Some("Bash"),
                Some("tu-bash"),
                None,
            ),
        ];
        let blocks = build_blocks(&msgs);
        assert_eq!(blocks.len(), 1, "Bash dup should still dedupe to one block");
        assert_eq!(blocks[0].type_, "tool_call");
        assert_eq!(
            blocks[0].content, original_args,
            "Bash tool_call content must not be overwritten by a larger duplicate"
        );
    }

    #[test]
    fn test_build_blocks_nested_agent_tool() {
        let msgs = vec![make_message_full(
            1,
            1,
            "tool_call",
            "{}",
            Some("Task"),
            Some("tu-task"),
            None,
        )];
        let blocks = build_blocks(&msgs);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].type_, "tool_call");
        // Task tool should have child_blocks slot (empty vec)
        assert!(
            blocks[0].child_blocks.is_some(),
            "Task tool should have child_blocks"
        );
    }

    #[test]
    fn test_build_blocks_mixed_sequence() {
        let msgs = vec![
            make_message(1, 1, "text", "Starting"),
            make_message_full(2, 1, "tool_call", "{}", Some("Bash"), Some("tu-1"), None),
            make_message_full(3, 1, "tool_result", "done", None, Some("tu-1"), None),
            make_message(4, 1, "text", "Done"),
        ];
        let blocks = build_blocks(&msgs);
        assert_eq!(blocks.len(), 4);
        assert_eq!(blocks[0].type_, "text");
        assert_eq!(blocks[1].type_, "tool_call");
        assert_eq!(blocks[2].type_, "tool_result");
        assert_eq!(blocks[3].type_, "text");
    }

    #[test]
    fn test_build_blocks_user_message() {
        let msgs = vec![
            make_message(1, 1, "user_message", "Hello from user"),
            make_message(2, 1, "text", "Hello from assistant"),
        ];
        let blocks = build_blocks(&msgs);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].type_, "user_message");
        assert_eq!(blocks[0].content, "Hello from user");
        assert_eq!(blocks[1].type_, "text");
        assert_eq!(blocks[1].content, "Hello from assistant");
    }

    #[test]
    fn test_build_blocks_user_message_not_merged_with_text() {
        // User messages should never merge with adjacent text blocks
        let msgs = vec![
            make_message(1, 1, "text", "Assistant text"),
            make_message(2, 1, "user_message", "User prompt"),
            make_message(3, 1, "text", "More assistant text"),
        ];
        let blocks = build_blocks(&msgs);
        assert_eq!(blocks.len(), 3);
        assert_eq!(blocks[0].type_, "text");
        assert_eq!(blocks[1].type_, "user_message");
        assert_eq!(blocks[2].type_, "text");
    }

    #[test]
    fn test_build_blocks_error_message_is_flagged() {
        let msgs = vec![make_message(1, 1, "error", "OpenCode stream failed")];
        let blocks = build_blocks(&msgs);

        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].type_, "text");
        assert_eq!(blocks[0].content, "Error: OpenCode stream failed");
        assert_eq!(blocks[0].is_error, Some(true));
    }

    #[test]
    fn test_build_blocks_tool_result_nests_under_agent_via_tool_use_id() {
        // Agent tool_result has parent_tool_use_id=None but shares tool_use_id with Agent tool_call.
        // build_blocks should nest it as a child of the Agent block.
        let msgs = vec![
            make_message_full(
                1,
                1,
                "tool_call",
                "{\"prompt\":\"explore\"}",
                Some("Agent"),
                Some("tu-agent"),
                None,
            ),
            // Sub-agent child messages
            make_message_full(
                2,
                1,
                "tool_call",
                "{\"command\":\"ls\"}",
                Some("Bash"),
                Some("tu-bash"),
                Some("tu-agent"),
            ),
            make_message_full(
                3,
                1,
                "tool_result",
                "file.txt",
                None,
                Some("tu-bash"),
                Some("tu-agent"),
            ),
            // Agent tool_result: same tool_use_id as Agent, no parent_tool_use_id
            make_message_full(
                4,
                1,
                "tool_result",
                "[{\"text\":\"Done\"}]",
                None,
                Some("tu-agent"),
                None,
            ),
        ];
        let blocks = build_blocks(&msgs);
        // Only the Agent block at root level
        assert_eq!(
            blocks.len(),
            1,
            "Agent tool_result should not be a root block"
        );
        let agent = &blocks[0];
        assert_eq!(agent.type_, "tool_call");
        let children = agent.child_blocks.as_ref().unwrap();
        assert_eq!(
            children.len(),
            3,
            "Agent should have 3 children: Bash call, Bash result, Agent result"
        );
        assert_eq!(children[2].type_, "tool_result");
        assert_eq!(children[2].source_tool_name.as_deref(), Some("Agent"));
        assert_eq!(children[2].content, "[{\"text\":\"Done\"}]");
    }

    // ---- Repository query tests ----

    #[tokio::test]
    async fn test_get_sessions() {
        let pool = setup_test_db().await;
        let fid: (i64,) = sqlx::query_as("INSERT INTO features (title) VALUES ('f') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
        let feature_id = fid.0;

        insert_session(&pool, feature_id, "running").await;
        insert_session(&pool, feature_id, "completed").await;

        let sessions = get_sessions(&pool, feature_id).await.unwrap();
        assert_eq!(sessions.len(), 2);
    }

    #[tokio::test]
    async fn test_get_sessions_empty() {
        let pool = setup_test_db().await;
        let sessions = get_sessions(&pool, 9999).await.unwrap();
        assert!(sessions.is_empty());
    }

    #[tokio::test]
    async fn test_get_feature_agent_state_basic() {
        let pool = setup_test_db().await;
        let fid: (i64,) = sqlx::query_as("INSERT INTO features (title) VALUES ('f') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
        let feature_id = fid.0;

        let session_id = insert_session(&pool, feature_id, "completed").await;
        insert_message(&pool, session_id, "text", "hello", None, None, None).await;

        let state = get_feature_agent_state(&pool, feature_id, None, None, None)
            .await
            .unwrap();
        assert_eq!(state.sessions.len(), 1);
        let s = &state.sessions[0];
        assert_eq!(s.session_db_id, session_id);
        assert_eq!(s.blocks.len(), 1);
        assert_eq!(s.blocks[0].content, "hello");
        assert!(s.phase_title.is_none());
    }

    #[tokio::test]
    async fn test_get_feature_agent_state_incremental() {
        let pool = setup_test_db().await;
        let fid: (i64,) = sqlx::query_as("INSERT INTO features (title) VALUES ('f') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
        let feature_id = fid.0;

        let session_id = insert_session(&pool, feature_id, "running").await;
        let msg1 = insert_message(&pool, session_id, "text", "old message", None, None, None).await;
        let msg2 =
            insert_message(&pool, session_id, "text", " new message", None, None, None).await;

        // Fetch with after_message_ids = {session_id: msg1}
        let mut after = HashMap::new();
        after.insert(session_id, msg1);
        let state = get_feature_agent_state(&pool, feature_id, Some(after), None, None)
            .await
            .unwrap();
        assert_eq!(state.sessions.len(), 1);
        let s = &state.sessions[0];
        assert!(s.is_incremental);
        // Only the new message (msg2) should be in blocks
        assert_eq!(s.blocks.len(), 1);
        assert_eq!(s.blocks[0].content, " new message");
        assert_eq!(s.max_message_id, msg2);
    }

    #[tokio::test]
    async fn test_get_feature_agent_state_no_sessions() {
        let pool = setup_test_db().await;
        let state = get_feature_agent_state(&pool, 9999, None, None, None)
            .await
            .unwrap();
        assert!(state.sessions.is_empty());
    }

    #[tokio::test]
    async fn test_get_feature_agent_state_with_limit() {
        let pool = setup_test_db().await;
        let fid: (i64,) = sqlx::query_as("INSERT INTO features (title) VALUES ('f') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
        let feature_id = fid.0;
        let session_id = insert_session(&pool, feature_id, "completed").await;

        // Insert 5 messages
        for i in 0..5 {
            insert_message(
                &pool,
                session_id,
                "text",
                &format!("msg {}", i),
                None,
                None,
                None,
            )
            .await;
        }

        // Fetch with limit=3 — should get only the last 3 messages
        let state = get_feature_agent_state(&pool, feature_id, None, Some(3), None)
            .await
            .unwrap();
        let s = &state.sessions[0];
        assert!(s.has_more, "should indicate more messages exist");
        assert!(s.oldest_message_id.is_some());
        // With limit=3 and text merging, blocks may be fewer than 3,
        // but max_message_id should be the last message
        assert!(s.max_message_id > 0);
    }

    #[tokio::test]
    async fn test_get_feature_agent_state_with_before() {
        let pool = setup_test_db().await;
        let fid: (i64,) = sqlx::query_as("INSERT INTO features (title) VALUES ('f') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
        let feature_id = fid.0;
        let session_id = insert_session(&pool, feature_id, "completed").await;

        let mut msg_ids = Vec::new();
        for i in 0..5 {
            let id = insert_message(
                &pool,
                session_id,
                "tool_call",
                &format!("{{\"cmd\":\"{}\"}}", i),
                Some("Bash"),
                Some(&format!("tu-{}", i)),
                None,
            )
            .await;
            msg_ids.push(id);
        }

        // Fetch messages before msg_ids[3] with limit=2
        let mut before_map = HashMap::new();
        before_map.insert(session_id, msg_ids[3]);
        let state = get_feature_agent_state(&pool, feature_id, None, Some(2), Some(before_map))
            .await
            .unwrap();
        let s = &state.sessions[0];
        // Should get messages with id < msg_ids[3], limited to 2
        assert_eq!(s.blocks.len(), 2);
        assert!(s.has_more, "should have more messages before these");
    }

    #[tokio::test]
    async fn test_paginated_cursor_ignores_injected_parent_rows() {
        let pool = setup_test_db().await;
        let fid: (i64,) = sqlx::query_as("INSERT INTO features (title) VALUES ('f') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
        let feature_id = fid.0;
        let session_id = insert_session(&pool, feature_id, "completed").await;

        let parent_id = insert_message(
            &pool,
            session_id,
            "tool_call",
            r#"{"description":"task"}"#,
            Some("Task"),
            Some("task-1"),
            None,
        )
        .await;
        let first_child_id = insert_message(
            &pool,
            session_id,
            "text",
            "older child",
            None,
            None,
            Some("task-1"),
        )
        .await;
        insert_message(
            &pool,
            session_id,
            "text",
            "newer child",
            None,
            None,
            Some("task-1"),
        )
        .await;
        let before_id =
            insert_message(&pool, session_id, "text", "outside page", None, None, None).await;

        let mut before_map = HashMap::new();
        before_map.insert(session_id, before_id);
        let state = get_feature_agent_state(&pool, feature_id, None, Some(2), Some(before_map))
            .await
            .unwrap();
        let s = &state.sessions[0];

        assert_eq!(s.oldest_message_id, Some(first_child_id));
        assert!(s.has_more);
        assert_ne!(s.oldest_message_id, Some(parent_id));
    }

    #[tokio::test]
    async fn test_get_feature_agent_state_no_limit_no_has_more() {
        let pool = setup_test_db().await;
        let fid: (i64,) = sqlx::query_as("INSERT INTO features (title) VALUES ('f') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
        let feature_id = fid.0;
        let session_id = insert_session(&pool, feature_id, "completed").await;

        insert_message(&pool, session_id, "text", "hello", None, None, None).await;

        // Fetch without limit — has_more should be false
        let state = get_feature_agent_state(&pool, feature_id, None, None, None)
            .await
            .unwrap();
        let s = &state.sessions[0];
        assert!(!s.has_more);
    }

    #[tokio::test]
    async fn test_get_session_status_snapshot() {
        use crate::domain::session_status::{AgentStatus, PendingKind};

        let pool = setup_test_db().await;

        let mk_feature = |label: &'static str| {
            let pool = pool.clone();
            async move {
                let row: (i64,) =
                    sqlx::query_as("INSERT INTO features (title) VALUES (?) RETURNING id")
                        .bind(label)
                        .fetch_one(&pool)
                        .await
                        .unwrap();
                row.0
            }
        };

        let fid1 = mk_feature("f1").await;
        let fid2 = mk_feature("f2").await;
        let fid3 = mk_feature("f3").await;
        let fid4 = mk_feature("f4").await;
        let fid5 = mk_feature("f5").await;

        // Feature 1: running session with pending_questions → Question/Question
        let sid1: i64 = sqlx::query_scalar(
            "INSERT INTO agent_sessions (feature_id, agent_type, status, pending_questions) \
             VALUES (?, 'main', 'running', '[\"q\"]') RETURNING id",
        )
        .bind(fid1)
        .fetch_one(&pool)
        .await
        .unwrap();

        // Feature 2: running session without pending_* → Agent
        let sid2 = insert_session(&pool, fid2, "running").await;

        // Feature 3: PAUSED session with pending_permission → Question/Permission
        // (workflow agents awaiting input are persisted as 'paused')
        let sid3: i64 = sqlx::query_scalar(
            "INSERT INTO agent_sessions (feature_id, agent_type, status, pending_permission) \
             VALUES (?, 'main', 'paused', '{\"request_id\":\"r\"}') RETURNING id",
        )
        .bind(fid3)
        .fetch_one(&pool)
        .await
        .unwrap();

        // Feature 4: PAUSED session with pending_prd_approval → Question/PrdApproval
        let sid4: i64 = sqlx::query_scalar(
            "INSERT INTO agent_sessions (feature_id, agent_type, status, pending_prd_approval) \
             VALUES (?, 'prd', 'paused', '{\"prd\":\"...\"}') RETURNING id",
        )
        .bind(fid4)
        .fetch_one(&pool)
        .await
        .unwrap();

        // Feature 5: PAUSED session with no pending_* columns → excluded
        // (plain paused, not waiting for input — must not surface in the snapshot)
        let sid5 = insert_session(&pool, fid5, "paused").await;

        let states = get_session_status_snapshot(&pool).await.unwrap();

        let s1 = states.get(&sid1.to_string()).unwrap();
        assert_eq!(s1.status, AgentStatus::Question);
        assert_eq!(s1.kind, Some(PendingKind::Question));
        assert_eq!(s1.feature_id, fid1);

        let s2 = states.get(&sid2.to_string()).unwrap();
        assert_eq!(s2.status, AgentStatus::Agent);
        assert_eq!(s2.kind, None);

        // Paused + pending must surface as Question (this was the sidebar-blank bug).
        let s3 = states.get(&sid3.to_string()).unwrap();
        assert_eq!(s3.status, AgentStatus::Question);
        assert_eq!(s3.kind, Some(PendingKind::Permission));

        let s4 = states.get(&sid4.to_string()).unwrap();
        assert_eq!(s4.status, AgentStatus::Question);
        assert_eq!(s4.kind, Some(PendingKind::PrdApproval));

        // Plain-paused must NOT appear (no pending → idle → filtered out).
        assert!(states.get(&sid5.to_string()).is_none());
    }

    #[tokio::test]
    async fn test_get_draft() {
        let pool = setup_test_db().await;
        let fid: (i64,) = sqlx::query_as("INSERT INTO features (title) VALUES ('f') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
        let session_id = insert_session(&pool, fid.0, "paused").await;

        save_draft(&pool, session_id, Some("my draft"))
            .await
            .unwrap();
        let draft = get_draft(&pool, session_id).await.unwrap();
        assert_eq!(draft.as_deref(), Some("my draft"));
    }

    #[tokio::test]
    async fn test_get_draft_empty() {
        let pool = setup_test_db().await;
        let fid: (i64,) = sqlx::query_as("INSERT INTO features (title) VALUES ('f') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
        let session_id = insert_session(&pool, fid.0, "paused").await;

        let draft = get_draft(&pool, session_id).await.unwrap();
        assert!(draft.is_none());
    }

    #[tokio::test]
    async fn test_save_draft_upsert() {
        let pool = setup_test_db().await;
        let fid: (i64,) = sqlx::query_as("INSERT INTO features (title) VALUES ('f') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
        let session_id = insert_session(&pool, fid.0, "paused").await;

        save_draft(&pool, session_id, Some("first draft"))
            .await
            .unwrap();
        save_draft(&pool, session_id, Some("updated draft"))
            .await
            .unwrap();

        let draft = get_draft(&pool, session_id).await.unwrap();
        assert_eq!(draft.as_deref(), Some("updated draft"));
    }

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

    // ---- trim_blocks_to_cap ----

    fn make_root_block(id_num: i64) -> AgentBlock {
        AgentBlock {
            id: format!("msg-{id_num}"),
            type_: "text".to_string(),
            content: String::new(),
            tool_name: None,
            tool_args: None,
            is_error: None,
            tool_use_id: None,
            parent_tool_use_id: None,
            child_blocks: None,
            source_tool_name: None,
            created_at: None,
            model: None,
            truncated_content: None,
        }
    }

    #[test]
    fn test_trim_blocks_to_cap_no_op() {
        let mut blocks: Vec<AgentBlock> = (1..=5).map(make_root_block).collect();
        let dropped = trim_blocks_to_cap(&mut blocks, 10);
        assert_eq!(dropped, 0);
        assert_eq!(blocks.len(), 5);
    }

    #[test]
    fn test_trim_blocks_to_cap_drops_oldest_roots() {
        let mut blocks: Vec<AgentBlock> = (1..=10).map(make_root_block).collect();
        let dropped = trim_blocks_to_cap(&mut blocks, 4);
        assert_eq!(dropped, 6);
        assert_eq!(blocks.len(), 4);
        // The surviving blocks should be the newest 4 (ids 7..=10).
        assert_eq!(blocks.first().map(|b| b.id.as_str()), Some("msg-7"));
        assert_eq!(blocks.last().map(|b| b.id.as_str()), Some("msg-10"));
    }

    #[test]
    fn test_trim_blocks_to_cap_counts_children() {
        // A root with 9 children = 10 blocks total. Cap=10 → no trim.
        // Add another root → 11 blocks total → must drop the older root.
        let mut root_with_kids = make_root_block(1);
        root_with_kids.child_blocks = Some((100..=108).map(make_root_block).collect());
        let mut blocks = vec![root_with_kids, make_root_block(2)];
        assert_eq!(total_block_count(&blocks), 11);
        let dropped = trim_blocks_to_cap(&mut blocks, 10);
        assert_eq!(dropped, 1);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].id, "msg-2");
    }

    #[tokio::test]
    async fn test_get_feature_agent_state_block_cap_trims_and_sets_has_more() {
        let pool = setup_test_db().await;
        let fid: (i64,) = sqlx::query_as("INSERT INTO features (title) VALUES ('f') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
        let session_id = insert_session(&pool, fid.0, "completed").await;

        // Insert > BLOCK_SOFT_CAP messages (each becomes one root block: distinct
        // tool_calls so text-merging doesn't collapse them).
        let total = BLOCK_SOFT_CAP + 50;
        for i in 0..total {
            insert_message(
                &pool,
                session_id,
                "tool_call",
                "{}",
                Some("Read"),
                Some(&format!("tu-cap-{i}")),
                None,
            )
            .await;
        }

        let state = get_feature_agent_state(&pool, fid.0, None, None, None)
            .await
            .unwrap();
        let s = &state.sessions[0];
        assert!(s.has_more, "trimmed response should report has_more=true");
        assert!(s.oldest_message_id.is_some());
        assert!(
            s.blocks.len() <= BLOCK_SOFT_CAP,
            "block count {} exceeds cap {BLOCK_SOFT_CAP}",
            s.blocks.len()
        );
    }

    // ---- get_message_content ----

    #[tokio::test]
    async fn test_get_message_content_returns_row() {
        let pool = setup_test_db().await;
        let fid: (i64,) = sqlx::query_as("INSERT INTO features (title) VALUES ('f') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
        let sid = insert_session(&pool, fid.0, "completed").await;
        let mid = insert_message(
            &pool,
            sid,
            "tool_result",
            "the full bash output",
            None,
            Some("tu-1"),
            None,
        )
        .await;

        let content = get_message_content(&pool, mid).await.unwrap();
        assert_eq!(content.as_deref(), Some("the full bash output"));
    }

    #[tokio::test]
    async fn test_get_message_content_missing_returns_none() {
        let pool = setup_test_db().await;
        let res = get_message_content(&pool, 999_999).await.unwrap();
        assert!(res.is_none());
    }
}
