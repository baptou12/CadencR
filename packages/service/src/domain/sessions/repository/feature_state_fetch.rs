//! SQL helpers for `get_feature_agent_state`. Extracted from the orchestrator
//! to keep `feature_state.rs` under the 400-line cap.
//!
//! These helpers are intentionally side-effect-free except for the database
//! reads — they hand back plain maps that the orchestrator weaves into the
//! per-session response.

use sqlx::SqlitePool;
use std::collections::HashMap;

use super::super::models::*;
use super::pagination::fetch_missing_parents;
use super::MESSAGE_SELECT;
use crate::error::AppError;

pub(super) struct FullMessagesResult {
    pub messages: HashMap<i64, Vec<AgentMessageRow>>,
    pub has_more: HashMap<i64, bool>,
    pub oldest_message_id: HashMap<i64, i64>,
}

/// Fetch messages for sessions that need a full (re)hydration. Picks
/// per-session paginated SQL when `limit` or `before_map` is set, else falls
/// back to an unbounded batch IN-query for the original fast path.
pub(super) async fn fetch_full_messages(
    pool: &SqlitePool,
    session_ids: &[i64],
    limit: Option<i64>,
    before_map: &HashMap<i64, i64>,
) -> Result<FullMessagesResult, AppError> {
    let mut messages: HashMap<i64, Vec<AgentMessageRow>> = HashMap::new();
    let mut has_more: HashMap<i64, bool> = HashMap::new();
    let mut oldest_message_id: HashMap<i64, i64> = HashMap::new();

    if session_ids.is_empty() {
        return Ok(FullMessagesResult {
            messages,
            has_more,
            oldest_message_id,
        });
    }

    if limit.is_some() || !before_map.is_empty() {
        // Built once per call (not per session) and only on the paginated
        // path — the unbounded branch below issues its own batch IN-query.
        let paginated_with_before_sql = format!(
            "{MESSAGE_SELECT} FROM agent_messages WHERE session_id = ? AND id < ? ORDER BY id DESC LIMIT ?"
        );
        let paginated_sql = format!(
            "{MESSAGE_SELECT} FROM agent_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?"
        );
        let msg_limit = limit.unwrap_or(i64::MAX);
        for sid in session_ids {
            let mut q = if let Some(&before_id) = before_map.get(sid) {
                sqlx::query_as::<_, AgentMessageRow>(&paginated_with_before_sql)
                    .bind(sid)
                    .bind(before_id)
            } else {
                sqlx::query_as::<_, AgentMessageRow>(&paginated_sql).bind(sid)
            };
            // Fetch limit+1 to detect has_more
            q = q.bind(msg_limit + 1);
            let mut msgs = q.fetch_all(pool).await?;
            let session_has_more = msgs.len() as i64 > msg_limit;
            if session_has_more {
                msgs.truncate(msg_limit as usize);
            }
            // Reverse to restore ASC order for block building
            msgs.reverse();
            if let Some(oldest) = msgs.first().map(|m| m.id) {
                oldest_message_id.insert(*sid, oldest);
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

            has_more.insert(*sid, session_has_more);
            messages.insert(*sid, msgs);
        }
    } else {
        // Unbounded batch fetch (no limit) — original fast path
        let placeholders = session_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "{MESSAGE_SELECT} FROM agent_messages WHERE session_id IN ({placeholders}) ORDER BY id ASC"
        );
        let mut q = sqlx::query_as::<_, AgentMessageRow>(&sql);
        for sid in session_ids {
            q = q.bind(sid);
        }
        let msgs = q.fetch_all(pool).await?;
        for msg in msgs {
            messages.entry(msg.session_id).or_default().push(msg);
        }
    }

    Ok(FullMessagesResult {
        messages,
        has_more,
        oldest_message_id,
    })
}

pub(super) struct IncrementalData {
    pub messages: HashMap<i64, Vec<AgentMessageRow>>,
    pub updated_tool_calls: HashMap<i64, HashMap<i64, String>>,
}

/// Fetch the new messages produced since `after_id` for each incremental
/// session, plus any stale tool_call rows whose content may have grown.
pub(super) async fn fetch_incremental_data(
    pool: &SqlitePool,
    fetches: &[(i64, i64)],
) -> Result<IncrementalData, AppError> {
    let mut messages: HashMap<i64, Vec<AgentMessageRow>> = HashMap::new();
    let mut updated_tool_calls: HashMap<i64, HashMap<i64, String>> = HashMap::new();

    for (sid, after_id) in fetches {
        let msgs = sqlx::query_as::<_, AgentMessageRow>(&format!(
            "{MESSAGE_SELECT} FROM agent_messages WHERE session_id = ? AND id > ? ORDER BY id ASC"
        ))
        .bind(sid)
        .bind(after_id)
        .fetch_all(pool)
        .await?;
        messages.insert(*sid, msgs);

        // Re-fetch stale tool_call rows
        let stale = sqlx::query_as::<_, AgentMessageRow>(&format!(
            "{MESSAGE_SELECT} FROM agent_messages WHERE session_id = ? AND id <= ? AND message_type = 'tool_call' AND content != '{{}}' ORDER BY id ASC"
        ))
        .bind(sid)
        .bind(after_id)
        .fetch_all(pool)
        .await?;
        if !stale.is_empty() {
            let map: HashMap<i64, String> = stale.into_iter().map(|r| (r.id, r.content)).collect();
            updated_tool_calls.insert(*sid, map);
        }
    }

    Ok(IncrementalData {
        messages,
        updated_tool_calls,
    })
}

/// Fetch the latest `TodoWrite` tool_call payload for each incremental
/// session, returning the parsed `todos` array.
pub(super) async fn fetch_latest_todos(
    pool: &SqlitePool,
    session_ids: &[i64],
) -> Result<HashMap<i64, Vec<serde_json::Value>>, AppError> {
    let mut todos_by_session: HashMap<i64, Vec<serde_json::Value>> = HashMap::new();
    for sid in session_ids {
        let row = sqlx::query_as::<_, AgentMessageRow>(&format!(
            "{MESSAGE_SELECT} FROM agent_messages WHERE session_id = ? AND message_type = 'tool_call' AND tool_name = 'TodoWrite' ORDER BY id DESC LIMIT 1"
        ))
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
    Ok(todos_by_session)
}
