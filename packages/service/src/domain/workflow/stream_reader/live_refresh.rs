//! Live-refresh detection for plan/phase-modifying tool calls.

use axum::extract::ws::Message;
use sqlx::SqlitePool;

use crate::domain::agents::adapter::{
    RuntimeContentBlock, RuntimeEvent, RuntimeStreamEvent,
};
use crate::domain::features::repository as repo;
use crate::domain::workflow::engine::{send_feature_updated_envelope, to_value, WsSender};
use crate::domain::ws_session::protocol::*;

pub fn is_completion_tool(name: &str) -> bool {
    name.contains("mark_agent_done")
        || name.contains("mark_phase_done")
        || name.contains("mark_phase_complete")
        || name.contains("request_approval")
}

/// Detect plan/phase-modifying tool calls and send live-refresh updates.
pub async fn handle_live_refresh(
    runtime_event: &RuntimeEvent,
    feature_id: i64,
    phase_slug: Option<&str>,
    sender: &WsSender,
    write_pool: &SqlitePool,
    agent_done_called: &mut bool,
    pending_feature_update: &mut Option<Vec<&'static str>>,
    pending_queue_update: &mut bool,
) {
    if let Some(message) = runtime_event.assistant_message() {
        handle_assistant_message(
            message,
            agent_done_called,
            pending_feature_update,
            pending_queue_update,
        );
    } else if runtime_event.user_message().is_some() {
        flush_pending_updates(
            sender,
            write_pool,
            feature_id,
            pending_feature_update,
            pending_queue_update,
        )
        .await;
    } else if let Some(data) = runtime_event.tool_use_summary_data() {
        handle_tool_use_summary(
            data,
            feature_id,
            phase_slug,
            sender,
            write_pool,
            agent_done_called,
        )
        .await;
    } else if let Some(RuntimeStreamEvent::ContentBlockStart {
        block: RuntimeContentBlock::ToolUse { name, .. },
        ..
    }) = runtime_event.stream_event()
    {
        // OpenCode surfaces tool_use as ContentBlockStart stream events rather
        // than assistant messages with content — without this branch we'd miss
        // `mark_agent_done` / phase-modifying tool calls and never advance.
        handle_tool_use_name(name, agent_done_called, pending_feature_update, pending_queue_update);
    }
}

fn handle_assistant_message(
    message: &crate::domain::agents::adapter::RuntimeAssistantMessage,
    agent_done_called: &mut bool,
    pending_feature_update: &mut Option<Vec<&'static str>>,
    pending_queue_update: &mut bool,
) {
    let mut fields: Vec<&'static str> = Vec::new();
    for block in &message.content {
        if let RuntimeContentBlock::ToolUse { name, .. } = block {
            if is_completion_tool(name) {
                *agent_done_called = true;
            }
            extend_fields_for_tool(name, &mut fields, pending_queue_update);
        }
    }
    if !fields.is_empty() {
        fields.dedup();
        *pending_feature_update = Some(fields);
    }
}

fn handle_tool_use_name(
    name: &str,
    agent_done_called: &mut bool,
    pending_feature_update: &mut Option<Vec<&'static str>>,
    pending_queue_update: &mut bool,
) {
    if is_completion_tool(name) {
        *agent_done_called = true;
    }
    let mut fields: Vec<&'static str> = Vec::new();
    extend_fields_for_tool(name, &mut fields, pending_queue_update);
    if fields.is_empty() {
        return;
    }
    match pending_feature_update {
        Some(existing) => {
            existing.extend(fields);
            existing.dedup();
        }
        None => *pending_feature_update = Some(fields),
    }
}

fn extend_fields_for_tool(
    name: &str,
    fields: &mut Vec<&'static str>,
    pending_queue_update: &mut bool,
) {
    if name.contains("create_phase") || name.contains("finalize_phases") {
        fields.extend_from_slice(&["phases", "progress"]);
        *pending_queue_update = true;
    } else if name.contains("finalize_plan") {
        fields.extend_from_slice(&["plan", "phases", "progress", "status"]);
    } else if name.contains("save_plan") || name.contains("create_plan") {
        fields.extend_from_slice(&["plan"]);
    } else if name.contains("save_prd") || name.contains("create_prd") {
        fields.extend_from_slice(&["prd"]);
    }
}

async fn flush_pending_updates(
    sender: &WsSender,
    write_pool: &SqlitePool,
    feature_id: i64,
    pending_feature_update: &mut Option<Vec<&'static str>>,
    pending_queue_update: &mut bool,
) {
    if *pending_queue_update {
        *pending_queue_update = false;
        send_queue_update(sender, write_pool, feature_id).await;
    }
    if let Some(fields) = pending_feature_update.take() {
        send_feature_updated_envelope(sender, feature_id, &fields);
    }
}

async fn handle_tool_use_summary(
    data: &serde_json::Value,
    feature_id: i64,
    phase_slug: Option<&str>,
    sender: &WsSender,
    write_pool: &SqlitePool,
    agent_done_called: &mut bool,
) {
    let Some(tool_name) = data.get("tool_name").and_then(|v| v.as_str()) else {
        return;
    };

    if is_completion_tool(tool_name) {
        *agent_done_called = true;
    }

    if tool_name.contains("create_artifact") || tool_name.contains("update_artifact") {
        if let Some(slug) = phase_slug {
            let envelope = WsEnvelope::new(
                "workflow",
                "artifact_updated",
                serde_json::json!({ "feature_id": feature_id, "phase_slug": slug }),
            );
            let _ = sender.send(Message::Text(String::from(envelope).into()));
        }
    }

    let changed: Option<&[&str]> = match tool_name {
        t if t.contains("create_phase") || t.contains("finalize_phases") => {
            send_queue_update(sender, write_pool, feature_id).await;
            Some(&["phases", "progress"])
        }
        t if t.contains("finalize_plan") => {
            send_queue_update(sender, write_pool, feature_id).await;
            Some(&["plan", "phases", "progress", "status"])
        }
        t if t.contains("save_plan") || t.contains("create_plan") => Some(&["plan"]),
        t if t.contains("save_prd") || t.contains("create_prd") => Some(&["prd"]),
        _ => None,
    };
    if let Some(fields) = changed {
        send_feature_updated_envelope(sender, feature_id, fields);
    }
}

/// Send a queue_update envelope to the frontend.
pub async fn send_queue_update(sender: &WsSender, write_pool: &SqlitePool, feature_id: i64) {
    if let Ok(items) = repo::get_queue_for_feature(write_pool, feature_id).await {
        let envelope = WsEnvelope::new(
            "workflow",
            "queue_update",
            to_value(WorkflowQueueUpdatePayload {
                feature_id,
                items,
                workflow_status: None,
            }),
        );
        let _ = sender.send(Message::Text(String::from(envelope).into()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_completion_tool() {
        assert!(is_completion_tool("mark_agent_done"));
        assert!(is_completion_tool("mark_phase_done"));
        assert!(is_completion_tool("mark_phase_complete"));
        assert!(is_completion_tool("request_approval"));
        assert!(is_completion_tool(
            "mcp__cadence_workflow__mark_phase_complete"
        ));
        assert!(!is_completion_tool("create_artifact"));
        assert!(!is_completion_tool("read_project_context"));
    }

    #[test]
    fn tool_use_name_sets_agent_done_for_opencode_canonical_name() {
        // OpenCode surfaces tool_use only as ContentBlockStart stream events;
        // handle_tool_use_name is the path that still detects `mark_agent_done`
        // so the workflow can finalize without an assistant-message fallback.
        let mut agent_done_called = false;
        let mut pending_feature_update = None;
        let mut pending_queue_update = false;
        handle_tool_use_name(
            "mcp__cadence-plan__mark_agent_done",
            &mut agent_done_called,
            &mut pending_feature_update,
            &mut pending_queue_update,
        );
        assert!(agent_done_called);
    }

    #[test]
    fn tool_use_name_records_pending_queue_update_for_create_phase() {
        let mut agent_done_called = false;
        let mut pending_feature_update = None;
        let mut pending_queue_update = false;
        handle_tool_use_name(
            "mcp__cadence-plan__create_phase",
            &mut agent_done_called,
            &mut pending_feature_update,
            &mut pending_queue_update,
        );
        assert!(!agent_done_called);
        assert!(pending_queue_update);
        assert_eq!(
            pending_feature_update.as_deref(),
            Some(&["phases", "progress"][..])
        );
    }
}
