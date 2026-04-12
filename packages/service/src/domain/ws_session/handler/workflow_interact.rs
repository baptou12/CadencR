//! Workflow interaction handlers: permission responses, prompts, interrupts, worktree retry.
//!
//! Extracted from workflow_complex.rs to keep files under 400 lines.

use axum::extract::ws::Message;
use std::path::PathBuf;
use tracing::{info, warn};

use super::workflow::{
    get_engine, parse_and_get_engine, parse_payload, send_workflow_error, to_value,
};
use super::WsSender;
use crate::app_state::AppState;
use crate::domain::workflow::engine::WorkflowEngine;
use crate::domain::workflow::worktree;
use crate::domain::ws_session::auto_name;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::*;
use crate::domain::ws_session::question_answers::{
    format_answers_markdown, format_answers_plain_text,
};

pub(super) async fn handle_permission_respond(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
) {
    let Some((payload, engine)) =
        parse_and_get_engine::<WorkflowPermissionRespondPayload>(&envelope, sender)
    else {
        return;
    };

    persist_qa_answer(&payload, &engine, app_state, sender).await;

    let response = super::session_prompt::PermissionResponse {
        request_id: payload.request_id.clone(),
        decision: payload.decision,
        feedback: payload.feedback,
        updated_input: payload.updated_input,
    };

    match engine
        .respond_permission(payload.agent_slot.clone(), response)
        .await
    {
        Ok(()) => {
            let ack = WsEnvelope::reply(
                &envelope.id,
                "workflow",
                "acknowledged",
                to_value(WorkflowAcknowledgedPayload {
                    feature_id: payload.feature_id,
                    action: "permission.respond".into(),
                }),
            );
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            warn!(feature_id = payload.feature_id, agent_slot = %payload.agent_slot, error = %e, "permission.respond failed — agent may be orphaned");
            send_workflow_error(sender, &envelope.id, "AGENT_ORPHANED", &e);
        }
    }
}

async fn persist_qa_answer(
    payload: &WorkflowPermissionRespondPayload,
    engine: &WorkflowEngine,
    app_state: &AppState,
    sender: &WsSender,
) {
    let Some(ref updated_input) = payload.updated_input else {
        return;
    };
    let Some(answer_text) = format_answers_plain_text(updated_input) else {
        return;
    };
    let Some(db_session_id_ref) = engine.active_items().get(&payload.agent_slot) else {
        return;
    };

    let db_session_id = *db_session_id_ref;
    let p = WsSessionPersistence::with_session_id(
        app_state.write_pool.clone(),
        payload.feature_id,
        Some(db_session_id),
    );
    p.persist_user_message(&answer_text).await;

    let formatted =
        format_answers_markdown(updated_input).unwrap_or_else(|| format_qa_answer(&answer_text));
    let user_msg = WsEnvelope::new(
        "workflow",
        "agent_user_message",
        serde_json::json!({
            "agent_slot": payload.agent_slot,
            "session_id": db_session_id,
            "content": formatted,
        }),
    );
    let _ = sender.send(Message::Text(String::from(user_msg).into()));
}

pub(super) async fn handle_prompt_send(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
) {
    let Some((payload, engine)) =
        parse_and_get_engine::<WorkflowPromptSendPayload>(&envelope, sender)
    else {
        return;
    };

    let images = payload.images.unwrap_or_default();
    if let Some(db_session_id_ref) = engine.active_items().get(&payload.agent_slot) {
        let db_session_id = *db_session_id_ref;
        let p = WsSessionPersistence::with_session_id(
            app_state.write_pool.clone(),
            payload.feature_id,
            Some(db_session_id),
        );
        let persist_content = super::session_prompt::build_persist_content(&payload.text, &images);
        p.persist_user_message(&persist_content).await;
    }

    match engine
        .send_prompt(payload.agent_slot.clone(), &payload.text, Some(images))
        .await
    {
        Ok(()) => {
            let ack = WsEnvelope::reply(
                &envelope.id,
                "workflow",
                "acknowledged",
                to_value(WorkflowAcknowledgedPayload {
                    feature_id: payload.feature_id,
                    action: "prompt.send".into(),
                }),
            );
            let _ = sender.send(Message::Text(String::from(ack).into()));
        }
        Err(e) => {
            warn!(feature_id = payload.feature_id, agent_slot = %payload.agent_slot, error = %e, "prompt.send failed — agent may be orphaned");
            send_workflow_error(sender, &envelope.id, "AGENT_ORPHANED", &e);
        }
    }
}

pub(super) async fn handle_interrupt(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
) {
    let Some(payload) = parse_payload::<WorkflowInterruptPayload>(&envelope, sender) else {
        return;
    };

    let slot = payload.agent_slot.clone();
    let interrupted_payload = || {
        to_value(WorkflowInterruptedPayload {
            feature_id: payload.feature_id,
            agent_slot: slot.clone(),
            status: "interrupted".into(),
        })
    };

    if let Some(engine) = get_engine(payload.feature_id) {
        match engine.interrupt_item(slot.clone()).await {
            Ok(()) => {
                let ack = WsEnvelope::reply(
                    &envelope.id,
                    "workflow",
                    "interrupted",
                    interrupted_payload(),
                );
                let _ = sender.send(Message::Text(String::from(ack).into()));
            }
            Err(e) => {
                send_workflow_error(
                    sender,
                    &envelope.id,
                    "INTERRUPT_FAILED",
                    &format!("Failed to interrupt slot {slot}: {e}"),
                );
            }
        }
    } else {
        handle_interrupt_no_engine(
            &payload,
            &slot,
            sender,
            &envelope,
            app_state,
            interrupted_payload,
        )
        .await;
    }
}

async fn handle_interrupt_no_engine(
    payload: &WorkflowInterruptPayload,
    slot: &crate::domain::workflow::engine::AgentSlot,
    sender: &WsSender,
    envelope: &WsEnvelope,
    app_state: &AppState,
    interrupted_payload: impl Fn() -> serde_json::Value,
) {
    use crate::domain::workflow::engine::AgentSlot;
    let AgentSlot::QueueItem(item_id) = slot else {
        send_workflow_error(
            sender,
            &envelope.id,
            "NO_ENGINE",
            &format!(
                "No workflow engine for feature {} and no PID fallback for non-queue slot",
                payload.feature_id
            ),
        );
        return;
    };

    info!(
        feature_id = payload.feature_id,
        item_id, "no engine, attempting PID-based interrupt"
    );
    use crate::domain::features::repository as repo;

    match repo::get_queue_item(&app_state.read_pool, *item_id).await {
        Ok(Some(item)) if item.pid.is_some() => {
            handle_pid_interrupt(
                item.pid.unwrap(),
                *item_id,
                payload,
                slot,
                sender,
                envelope,
                app_state,
                &interrupted_payload,
            )
            .await;
        }
        Ok(Some(_)) => {
            send_workflow_error(
                sender,
                &envelope.id,
                "NO_PID",
                &format!("No PID recorded for item {item_id}"),
            );
        }
        Ok(None) => {
            send_workflow_error(
                sender,
                &envelope.id,
                "NOT_FOUND",
                &format!("Queue item {item_id} not found"),
            );
        }
        Err(e) => {
            send_workflow_error(
                sender,
                &envelope.id,
                "DB_ERROR",
                &format!("Failed to look up item: {e}"),
            );
        }
    }
}

async fn handle_pid_interrupt(
    pid: i64,
    item_id: i64,
    payload: &WorkflowInterruptPayload,
    slot: &crate::domain::workflow::engine::AgentSlot,
    sender: &WsSender,
    envelope: &WsEnvelope,
    app_state: &AppState,
    interrupted_payload: &impl Fn() -> serde_json::Value,
) {
    use crate::domain::features::repository as repo;

    warn!(
        item_id,
        pid, "no-engine PID fallback interrupt (PID reuse risk)"
    );
    let result = unsafe { libc::kill(pid as libc::pid_t, libc::SIGINT) };
    if result == 0 {
        info!(item_id, pid, "sent SIGINT via PID fallback (no engine)");
        let ack = WsEnvelope::reply(
            &envelope.id,
            "workflow",
            "interrupted",
            interrupted_payload(),
        );
        let _ = sender.send(Message::Text(String::from(ack).into()));
    } else {
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() == Some(libc::ESRCH) {
            let _ = repo::mark_item_error(
                &app_state.write_pool,
                item_id,
                Some("Agent process no longer running"),
            )
            .await;
            let err_env = WsEnvelope::new(
                "workflow",
                "item_error",
                to_value(WorkflowItemErrorPayload {
                    feature_id: payload.feature_id,
                    agent_slot: slot.clone(),
                    error: "Agent process no longer running".into(),
                }),
            );
            let _ = sender.send(Message::Text(String::from(err_env).into()));
            send_workflow_error(
                sender,
                &envelope.id,
                "PROCESS_DEAD",
                "Agent process already exited",
            );
        } else {
            send_workflow_error(
                sender,
                &envelope.id,
                "INTERRUPT_FAILED",
                &format!("kill({pid}, SIGINT) failed: {err}"),
            );
        }
    }
}

pub(super) async fn handle_retry_worktree_setup(
    envelope: WsEnvelope,
    sender: &WsSender,
    app_state: &AppState,
) {
    let Some(payload) = parse_payload::<WorkflowContinuePayload>(&envelope, sender) else {
        return;
    };
    let feature_id = payload.feature_id;

    let Some(worktree_path) =
        worktree::get_setting(&app_state.read_pool, feature_id, "worktree_path").await
    else {
        warn!(feature_id, "retry_worktree_setup: no worktree path found");
        return;
    };

    let _ = worktree::set_setting(
        &app_state.write_pool,
        feature_id,
        "worktree_setup_step",
        "setup",
    )
    .await;
    let _ =
        worktree::set_setting(&app_state.write_pool, feature_id, "worktree_setup_log", "").await;

    let read_pool = app_state.read_pool.clone();
    let write_pool = app_state.write_pool.clone();
    let ws = crate::domain::workflow::engine::WsSender::new(sender.clone());
    let path = PathBuf::from(worktree_path);
    tokio::spawn(async move {
        worktree::run_setup_commands(read_pool, write_pool, feature_id, path, ws).await;
    });
}

/// Shared worktree preparation for plan/PRD handlers.
pub(super) async fn prepare_worktree(
    feature_id: i64,
    description: &str,
    engine_sender: &crate::domain::workflow::engine::WsSender,
    app_state: &AppState,
) -> Result<(), String> {
    let project_id = worktree::get_project_id_for_feature(&app_state.read_pool, feature_id).await?;
    let project_dir = worktree::get_project_directory(&app_state.read_pool, project_id).await?;

    if auto_name::has_default_title(&app_state.read_pool, feature_id).await {
        info!(feature_id, "auto-naming feature before worktree creation");
        if let Some(raw) = engine_sender.raw_clone() {
            let _ = auto_name::auto_name_feature(
                app_state.write_pool.clone(),
                feature_id,
                description.to_string(),
                project_dir.clone(),
                None,
                raw,
            )
            .await;
        }
    }

    let worktree_path = worktree::ensure_worktree(
        &app_state.read_pool,
        &app_state.write_pool,
        feature_id,
        project_id,
        engine_sender,
    )
    .await?;

    let setup_step =
        worktree::get_setting(&app_state.read_pool, feature_id, "worktree_setup_step").await;
    if setup_step.as_deref() != Some("ready") {
        let read_pool = app_state.read_pool.clone();
        let write_pool = app_state.write_pool.clone();
        let ws = engine_sender.clone();
        tokio::spawn(async move {
            worktree::run_setup_commands(read_pool, write_pool, feature_id, worktree_path, ws)
                .await;
        });
    }

    Ok(())
}

/// Format a raw Q&A response string into markdown with italic questions and bold answers.
pub(super) fn format_qa_answer(raw: &str) -> String {
    raw.split("\n\n")
        .map(|qa| {
            let mut lines = qa.lines();
            let question = lines.next().unwrap_or("");
            let answer: String = lines
                .map(|l| l.strip_prefix("Answer: ").unwrap_or(l))
                .collect::<Vec<_>>()
                .join("\n");
            format!("*{question}*\n\n**{answer}**")
        })
        .collect::<Vec<_>>()
        .join("\n\n\n\n")
}
