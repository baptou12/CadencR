use std::collections::HashMap;

use chrono::{DateTime, NaiveDateTime, Utc};

use super::models::AgentMessageRow;

#[derive(Debug, Clone)]
struct TaskInvocation {
    child_session_id: String,
    tool_use_id: String,
    started_at_ms: i64,
}

pub fn reassign_reused_child_message_parents(messages: &mut [AgentMessageRow]) -> bool {
    let invocations = collect_task_invocations(messages);
    let reused = collect_reused_invocations(&invocations);
    if reused.is_empty() {
        return false;
    }

    let parent_to_session: HashMap<String, String> = reused
        .values()
        .flat_map(|items| {
            items
                .iter()
                .map(|item| (item.tool_use_id.clone(), item.child_session_id.clone()))
        })
        .collect();

    let mut changed = false;
    for message in messages.iter_mut() {
        let Some(current_parent) = message.parent_tool_use_id.clone() else {
            continue;
        };
        let Some(child_session_id) = parent_to_session.get(&current_parent) else {
            continue;
        };
        let Some(message_time_ms) = parse_timestamp_ms(message.created_at.as_deref()) else {
            continue;
        };
        let Some(invocations_for_session) = reused.get(child_session_id) else {
            continue;
        };
        let Some(target_parent) = latest_parent_for_time(invocations_for_session, message_time_ms)
        else {
            continue;
        };
        if target_parent == current_parent {
            continue;
        }
        message.parent_tool_use_id = Some(target_parent);
        changed = true;
    }

    changed
}

fn collect_task_invocations(messages: &[AgentMessageRow]) -> Vec<TaskInvocation> {
    messages
        .iter()
        .filter(|message| {
            message.message_type == "tool_call"
                && matches!(message.tool_name.as_deref(), Some("Task") | Some("Agent"))
        })
        .filter_map(|message| {
            let tool_use_id = message.tool_use_id.as_ref()?;
            let created_at = parse_timestamp_ms(message.created_at.as_deref())?;
            let parsed = serde_json::from_str::<serde_json::Value>(&message.content).ok()?;
            let child_session_id = parsed
                .get("subagent_session_id")
                .or_else(|| parsed.get("task_id"))
                .and_then(serde_json::Value::as_str)?;
            Some(TaskInvocation {
                child_session_id: child_session_id.to_string(),
                tool_use_id: tool_use_id.clone(),
                started_at_ms: created_at,
            })
        })
        .collect()
}

fn collect_reused_invocations(
    invocations: &[TaskInvocation],
) -> HashMap<String, Vec<TaskInvocation>> {
    let mut by_session_id: HashMap<String, Vec<TaskInvocation>> = HashMap::new();
    for invocation in invocations {
        by_session_id
            .entry(invocation.child_session_id.clone())
            .or_default()
            .push(invocation.clone());
    }

    by_session_id.retain(|_, items| items.len() > 1);
    for items in by_session_id.values_mut() {
        items.sort_by_key(|item| item.started_at_ms);
    }
    by_session_id
}

fn latest_parent_for_time(invocations: &[TaskInvocation], message_time_ms: i64) -> Option<String> {
    invocations
        .iter()
        .rev()
        .find(|invocation| invocation.started_at_ms <= message_time_ms)
        .map(|invocation| invocation.tool_use_id.clone())
}

fn parse_timestamp_ms(raw: Option<&str>) -> Option<i64> {
    let raw = raw?;
    if let Ok(parsed) = DateTime::parse_from_rfc3339(raw) {
        return Some(parsed.timestamp_millis());
    }
    if let Ok(parsed) = NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S") {
        return Some(DateTime::<Utc>::from_naive_utc_and_offset(parsed, Utc).timestamp_millis());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::reassign_reused_child_message_parents;
    use crate::domain::sessions::models::AgentMessageRow;

    fn row(
        id: i64,
        message_type: &str,
        tool_name: Option<&str>,
        tool_use_id: Option<&str>,
        parent_tool_use_id: Option<&str>,
        content: &str,
        created_at: &str,
    ) -> AgentMessageRow {
        AgentMessageRow {
            id,
            session_id: 1,
            content: content.to_string(),
            message_type: message_type.to_string(),
            tool_name: tool_name.map(ToOwned::to_owned),
            tool_use_id: tool_use_id.map(ToOwned::to_owned),
            parent_tool_use_id: parent_tool_use_id.map(ToOwned::to_owned),
            created_at: Some(created_at.to_string()),
            model: None,
        }
    }

    #[test]
    fn reassigns_reused_child_session_messages_to_latest_task() {
        let mut messages = vec![
            row(
                1,
                "tool_call",
                Some("Task"),
                Some("task_1"),
                None,
                r#"{"description":"First","subagent_session_id":"ses_child"}"#,
                "2026-04-13 07:33:17",
            ),
            row(
                2,
                "text",
                None,
                None,
                Some("task_1"),
                "before continue",
                "2026-04-13 07:34:00",
            ),
            row(
                3,
                "tool_call",
                Some("Task"),
                Some("task_2"),
                None,
                r#"{"description":"Resume","subagent_session_id":"ses_child","task_id":"ses_child"}"#,
                "2026-04-13 07:34:15",
            ),
            row(
                4,
                "tool_call",
                Some("Read"),
                Some("tool_read_1"),
                Some("task_1"),
                r#"{"status":"completed"}"#,
                "2026-04-13 07:34:19",
            ),
            row(
                5,
                "text",
                None,
                None,
                Some("task_1"),
                "after continue",
                "2026-04-13 07:34:20",
            ),
        ];

        let changed = reassign_reused_child_message_parents(&mut messages);

        assert!(changed);
        assert_eq!(messages[1].parent_tool_use_id.as_deref(), Some("task_1"));
        assert_eq!(messages[3].parent_tool_use_id.as_deref(), Some("task_2"));
        assert_eq!(messages[4].parent_tool_use_id.as_deref(), Some("task_2"));
    }
}
