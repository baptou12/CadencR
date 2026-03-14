use std::collections::HashMap;
use sqlx::SqlitePool;

use crate::error::AppError;
use super::models::*;

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
        Some(b.child_indices.iter().map(|&ci| convert_block(ci, all)).collect())
    } else {
        None
    };
    AgentBlock {
        id: b.id.clone(),
        type_: b.type_.clone(),
        content: b.content.clone(),
        tool_name: b.tool_name.clone(),
        tool_args: if b.type_ == "tool_call" { Some(b.content.clone()) } else { None },
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
                    all[li].type_ == "thinking" && all[li].parent_tool_use_id.as_deref() == parent_id
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
                        if !msg.content.is_empty() && msg.content.len() > all[existing_idx].content.len() {
                            all[existing_idx].content = msg.content.clone();
                        }
                        continue;
                    }
                }

                let is_task = msg.tool_name.as_deref() == Some("Task") || msg.tool_name.as_deref() == Some("Agent");
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
                let source_tool_name = msg.tool_use_id.as_deref()
                    .and_then(|tuid| tool_use_id_map.get(tuid))
                    .and_then(|&idx| all[idx].tool_name.clone())
                    .or_else(|| {
                        // Fallback: scan backwards for last tool_call in list
                        let list = if let Some(pidx) = parent_idx {
                            &all[pidx].child_indices as &[usize]
                        } else {
                            &root_indices
                        };
                        list.iter().rev()
                            .find(|&&li| all[li].type_ == "tool_call")
                            .and_then(|&li| all[li].tool_name.clone())
                    });

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
                if let Some(pidx) = parent_idx {
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
            "compact_divider" => {
                let new_idx = all.len();
                all.push(MutableBlock {
                    id,
                    type_: "compact_divider".to_string(),
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

    root_indices.iter().map(|&idx| convert_block(idx, &all)).collect()
}

// ---- Repository functions ----

pub async fn get_sessions(pool: &SqlitePool, feature_id: i64) -> Result<Vec<AgentSessionRow>, AppError> {
    let rows = sqlx::query_as::<_, AgentSessionRow>(
        r#"SELECT id, feature_id, agent_type, claude_session_id, status, started_at, ended_at,
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
) -> Result<FeatureAgentStateResponse, AppError> {
    let sessions = sqlx::query_as::<_, AgentSessionRow>(
        r#"SELECT id, feature_id, agent_type, claude_session_id, status, started_at, ended_at,
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
    let phase_ids: Vec<i64> = sessions.iter()
        .filter_map(|s| s.phase_id)
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    let mut phase_title_map: HashMap<i64, String> = HashMap::new();
    if !phase_ids.is_empty() {
        // Build dynamic IN clause
        let placeholders = phase_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!("SELECT id, title FROM phases WHERE id IN ({})", placeholders);
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

    // Batch-fetch messages for full-fetch sessions
    let mut full_messages: HashMap<i64, Vec<AgentMessageRow>> = HashMap::new();
    if !full_fetch_ids.is_empty() {
        let placeholders = full_fetch_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
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
    let session_states: Vec<SessionState> = sessions.into_iter().map(|s| {
        let is_incremental = incremental_messages.contains_key(&s.id);
        let msgs = if is_incremental {
            incremental_messages.get(&s.id).cloned().unwrap_or_default()
        } else {
            full_messages.get(&s.id).cloned().unwrap_or_default()
        };

        // Extract todos for full-fetch sessions
        if !is_incremental {
            for msg in msgs.iter().rev() {
                if msg.message_type == "tool_call" && msg.tool_name.as_deref() == Some("TodoWrite") {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&msg.content) {
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
            if new_max > 0 { new_max } else { after_map.get(&s.id).copied().unwrap_or(0) }
        } else {
            msgs.iter().map(|m| m.id).max().unwrap_or(0)
        };

        let blocks = build_blocks(&msgs);

        let tool_call_updates: Option<HashMap<String, String>> = if is_incremental {
            updated_tool_calls.get(&s.id).map(|m| {
                m.iter().map(|(id, content)| (format!("msg-{}", id), content.clone())).collect()
            })
        } else {
            None
        };

        let pending_questions = s.pending_questions.as_deref()
            .and_then(|pq| serde_json::from_str(pq).ok());
        let pending_plan_approval = s.pending_plan_approval.as_deref()
            .and_then(|p| serde_json::from_str(p).ok());
        let pending_prd_approval = s.pending_prd_approval.as_deref()
            .and_then(|p| serde_json::from_str(p).ok());
        let pending_permission = s.pending_permission.as_deref()
            .and_then(|p| serde_json::from_str(p).ok());

        let resumable = (s.status == "paused" || s.status == "completed" || s.status == "error")
            && s.claude_session_id.is_some();

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
            claude_session_id: s.claude_session_id,
            run_id: s.run_id,
            phase_id: s.phase_id,
            phase_title: s.phase_id.and_then(|pid| phase_title_map.get(&pid).cloned()),
            todos: todos_by_session.get(&s.id).cloned(),
            permission_mode: s.permission_mode.unwrap_or_else(|| "acceptEdits".to_string()),
            pending_plan_approval,
            pending_prd_approval,
            pending_permission,
            input_tokens: s.input_tokens.unwrap_or(0),
            output_tokens: s.output_tokens.unwrap_or(0),
            context_window: s.context_window.unwrap_or(200000),
            was_compacted: s.was_compacted != 0,
            draft_prompt: s.draft_prompt,
        }
    }).collect();

    Ok(FeatureAgentStateResponse { sessions: session_states })
}

pub async fn get_feature_turn_states(pool: &SqlitePool) -> Result<HashMap<String, String>, AppError> {
    let rows = sqlx::query_as::<_, TurnStateRow>(
        r#"SELECT feature_id,
           MAX(CASE WHEN pending_questions IS NOT NULL OR pending_permission IS NOT NULL OR pending_plan_approval IS NOT NULL OR pending_prd_approval IS NOT NULL THEN 1 ELSE 0 END) AS needs_input
           FROM agent_sessions
           WHERE status = 'running'
           GROUP BY feature_id"#,
    )
    .fetch_all(pool)
    .await?;

    let mut result = HashMap::new();
    for row in rows {
        let turn = if row.needs_input == 1 { "askUser" } else { "claude" };
        result.insert(row.feature_id.to_string(), turn.to_string());
    }
    Ok(result)
}

pub async fn get_draft(pool: &SqlitePool, session_id: i64) -> Result<Option<String>, AppError> {
    let row: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT draft_prompt FROM agent_sessions WHERE id = ?",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.and_then(|(v,)| v))
}

pub async fn save_draft(pool: &SqlitePool, session_id: i64, draft: Option<&str>) -> Result<(), AppError> {
    sqlx::query("UPDATE agent_sessions SET draft_prompt = ? WHERE id = ?")
        .bind(draft)
        .bind(session_id)
        .execute(pool)
        .await?;
    Ok(())
}
