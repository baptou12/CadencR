use sqlx::SqlitePool;
use std::collections::HashMap;

use super::models::*;
use super::opencode_reparent::reassign_reused_child_message_parents;
use super::opencode_restore::{
    hydrate_opencode_tool_calls_with_children, should_hydrate_opencode_child_sessions,
    should_hydrate_opencode_tool_calls, synthesize_opencode_child_rows,
};
use crate::error::AppError;

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
                    });
                    if let Some(pidx) = parent_idx {
                        all[pidx].child_indices.push(new_idx);
                    } else {
                        root_indices.push(new_idx);
                    }
                }
            }
            "tool_call" => {
                // Deduplicate: if tool_use_id already seen, update content if longer
                if let Some(tuid) = &msg.tool_use_id {
                    if let Some(&existing_idx) = tool_use_id_map.get(tuid.as_str()) {
                        if !msg.content.is_empty()
                            && msg.content.len() > all[existing_idx].content.len()
                        {
                            all[existing_idx].content = msg.content.clone();
                        }
                        continue;
                    }
                }

                let is_task = msg.tool_name.as_deref() == Some("Task")
                    || msg.tool_name.as_deref() == Some("Agent");
                let new_idx = all.len();
                all.push(MutableBlock {
                    id,
                    type_: "tool_call".to_string(),
                    content: msg.content.clone(),
                    tool_name: msg.tool_name.clone().or(Some("tool".to_string())),
                    tool_use_id: msg.tool_use_id.clone(),
                    parent_tool_use_id: msg.parent_tool_use_id.clone(),
                    is_error: None,
                    source_tool_name: None,
                    created_at: msg.created_at.clone(),
                    model: None,
                    has_child_slots: is_task,
                    child_indices: Vec::new(),
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

                let new_idx = all.len();
                all.push(MutableBlock {
                    id,
                    type_: "tool_result".to_string(),
                    content: msg.content.clone(),
                    tool_name: None,
                    tool_use_id: msg.tool_use_id.clone(),
                    parent_tool_use_id: msg.parent_tool_use_id.clone(),
                    is_error: Some(is_error),
                    source_tool_name,
                    created_at: msg.created_at.clone(),
                    model: None,
                    has_child_slots: false,
                    child_indices: Vec::new(),
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

    hydrate_full_opencode_sessions(&sessions, &mut full_messages).await;

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

            let blocks = build_blocks(&msgs);

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
                has_more: *has_more_map.get(&s.id).unwrap_or(&false),
                oldest_message_id: oldest_message_id_map
                    .get(&s.id)
                    .copied()
                    .or_else(|| msgs.first().map(|m| m.id)),
            }
        })
        .collect();

    Ok(FeatureAgentStateResponse {
        sessions: session_states,
    })
}

async fn hydrate_full_opencode_sessions(
    sessions: &[AgentSessionRow],
    full_messages: &mut HashMap<i64, Vec<AgentMessageRow>>,
) {
    let client = opencode_sdk_rs::OpenCodeClient::new(4096);

    for session in sessions {
        if session.runtime_provider.as_deref() != Some("opencode") {
            continue;
        }
        let Some(runtime_session_id) = session.runtime_session_id.as_deref() else {
            continue;
        };
        let Some(messages) = full_messages.get_mut(&session.id) else {
            continue;
        };
        let hydrate_tool_calls = should_hydrate_opencode_tool_calls(messages);
        let hydrate_child_sessions = should_hydrate_opencode_child_sessions(messages);
        if !hydrate_tool_calls && !hydrate_child_sessions {
            continue;
        }
        let Ok(provider_messages) = client.list_messages(runtime_session_id).await else {
            continue;
        };
        let mut child_messages_by_session: HashMap<String, Vec<opencode_sdk_rs::Message>> =
            HashMap::new();
        if hydrate_tool_calls || hydrate_child_sessions {
            let root_directory = client
                .get_session_any(runtime_session_id)
                .await
                .ok()
                .map(|session| session.directory);
            if let Ok(children) = client
                .list_children_in_directory(runtime_session_id, root_directory.as_deref())
                .await
            {
                for child in children {
                    let Ok(child_messages) = client.list_messages(&child.id).await else {
                        continue;
                    };
                    child_messages_by_session.insert(child.id, child_messages);
                }
            }
        }
        if hydrate_tool_calls {
            let _ = hydrate_opencode_tool_calls_with_children(
                messages,
                &provider_messages,
                &child_messages_by_session,
            );
        }
        let _ = reassign_reused_child_message_parents(messages);
        if hydrate_child_sessions {
            let synthesized = synthesize_opencode_child_rows(
                messages,
                &provider_messages,
                &child_messages_by_session,
            );
            messages.extend(synthesized);
        }
    }
}

pub async fn get_feature_turn_states(
    pool: &SqlitePool,
) -> Result<HashMap<String, crate::domain::sessions::models::FeatureTurnState>, AppError> {
    // MAX() over the CASE expressions surfaces the first non-NULL kind when
    // multiple rows share a feature_id (shouldn't happen in practice, but the
    // aggregation keeps the query symmetric with `needs_input`).
    // Includes `status='paused'` rows that have a pending-input column set —
    // a workflow agent awaiting user input (permission/question/plan/prd
    // approval) is persisted as `paused` but must still surface on the
    // sidebar as `askUser`. Plain-paused rows (no pending column) are excluded
    // so they don't resurrect as a fake "agent" turn.
    let rows = sqlx::query_as::<_, TurnStateRow>(
        r#"SELECT feature_id,
           MAX(CASE WHEN pending_questions IS NOT NULL OR pending_permission IS NOT NULL OR pending_plan_approval IS NOT NULL OR pending_prd_approval IS NOT NULL THEN 1 ELSE 0 END) AS needs_input,
           MAX(CASE
                 WHEN pending_questions IS NOT NULL THEN 'question'
                 WHEN pending_permission IS NOT NULL THEN 'permission'
                 WHEN pending_plan_approval IS NOT NULL THEN 'plan-approval'
                 WHEN pending_prd_approval IS NOT NULL THEN 'prd-approval'
                 ELSE NULL
               END) AS pending_kind
           FROM agent_sessions
           WHERE status = 'running'
              OR (status = 'paused' AND (
                   pending_questions IS NOT NULL
                   OR pending_permission IS NOT NULL
                   OR pending_plan_approval IS NOT NULL
                   OR pending_prd_approval IS NOT NULL
                 ))
           GROUP BY feature_id"#,
    )
    .fetch_all(pool)
    .await?;

    let mut result = HashMap::new();
    for row in rows {
        let (turn, kind) = if row.needs_input == 1 {
            ("askUser", row.pending_kind)
        } else {
            ("agent", None)
        };
        result.insert(
            row.feature_id.to_string(),
            crate::domain::sessions::models::FeatureTurnState {
                turn: turn.to_string(),
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
        let msgs = vec![
            make_message_full(1, 1, "tool_call", "{}", Some("Bash"), Some("tu-dup"), None),
            make_message_full(
                2,
                1,
                "tool_call",
                "{\"cmd\":\"ls\"}",
                Some("Bash"),
                Some("tu-dup"),
                None,
            ),
        ];
        let blocks = build_blocks(&msgs);
        assert_eq!(blocks.len(), 1, "duplicate tool_use_id should deduplicate");
        assert_eq!(blocks[0].type_, "tool_call");
        // content updated to longer version
        assert_eq!(blocks[0].content, "{\"cmd\":\"ls\"}");
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
    async fn test_get_feature_turn_states() {
        let pool = setup_test_db().await;

        let fid1: (i64,) =
            sqlx::query_as("INSERT INTO features (title) VALUES ('f1') RETURNING id")
                .fetch_one(&pool)
                .await
                .unwrap();
        let fid2: (i64,) =
            sqlx::query_as("INSERT INTO features (title) VALUES ('f2') RETURNING id")
                .fetch_one(&pool)
                .await
                .unwrap();
        let fid3: (i64,) =
            sqlx::query_as("INSERT INTO features (title) VALUES ('f3') RETURNING id")
                .fetch_one(&pool)
                .await
                .unwrap();
        let fid4: (i64,) =
            sqlx::query_as("INSERT INTO features (title) VALUES ('f4') RETURNING id")
                .fetch_one(&pool)
                .await
                .unwrap();
        let fid5: (i64,) =
            sqlx::query_as("INSERT INTO features (title) VALUES ('f5') RETURNING id")
                .fetch_one(&pool)
                .await
                .unwrap();

        // Feature 1: running session with pending_questions → askUser/question
        sqlx::query(
            "INSERT INTO agent_sessions (feature_id, agent_type, status, pending_questions) VALUES (?, 'main', 'running', '[\"q\"]')"
        )
        .bind(fid1.0)
        .execute(&pool)
        .await
        .unwrap();

        // Feature 2: running session without pending_* → agent turn
        insert_session(&pool, fid2.0, "running").await;

        // Feature 3: PAUSED session with pending_permission → askUser/permission
        // (workflow agents awaiting input are persisted as 'paused')
        sqlx::query(
            "INSERT INTO agent_sessions (feature_id, agent_type, status, pending_permission) VALUES (?, 'main', 'paused', '{\"request_id\":\"r\"}')"
        )
        .bind(fid3.0)
        .execute(&pool)
        .await
        .unwrap();

        // Feature 4: PAUSED session with pending_prd_approval → askUser/prd-approval
        sqlx::query(
            "INSERT INTO agent_sessions (feature_id, agent_type, status, pending_prd_approval) VALUES (?, 'prd', 'paused', '{\"prd\":\"...\"}')"
        )
        .bind(fid4.0)
        .execute(&pool)
        .await
        .unwrap();

        // Feature 5: PAUSED session with no pending_* columns → excluded
        // (plain paused, not waiting for input — must not surface)
        insert_session(&pool, fid5.0, "paused").await;

        let states = get_feature_turn_states(&pool).await.unwrap();
        assert_eq!(
            states.get(&fid1.0.to_string()).map(|s| s.turn.as_str()),
            Some("askUser")
        );
        assert_eq!(
            states
                .get(&fid1.0.to_string())
                .and_then(|s| s.kind.as_deref()),
            Some("question"),
        );
        assert_eq!(
            states.get(&fid2.0.to_string()).map(|s| s.turn.as_str()),
            Some("agent")
        );
        assert_eq!(
            states
                .get(&fid2.0.to_string())
                .and_then(|s| s.kind.as_deref()),
            None,
        );
        // Paused + pending must surface as askUser (was the sidebar-blank bug).
        assert_eq!(
            states.get(&fid3.0.to_string()).map(|s| s.turn.as_str()),
            Some("askUser"),
        );
        assert_eq!(
            states
                .get(&fid3.0.to_string())
                .and_then(|s| s.kind.as_deref()),
            Some("permission"),
        );
        assert_eq!(
            states.get(&fid4.0.to_string()).map(|s| s.turn.as_str()),
            Some("askUser"),
        );
        assert_eq!(
            states
                .get(&fid4.0.to_string())
                .and_then(|s| s.kind.as_deref()),
            Some("prd-approval"),
        );
        // Plain-paused must NOT appear (no pending → not waiting for input).
        assert!(states.get(&fid5.0.to_string()).is_none());
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
}
