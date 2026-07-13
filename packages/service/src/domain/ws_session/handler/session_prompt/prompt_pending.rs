mod active_session;
use super::super::{SdkSessions, SessionConfig, WsSender};
use super::bridge::{PermissionResponse, WsBridgeCanUseTool};
use super::content::{
    build_content_value_for_provider, build_persist_content, payload_attachments,
};
use super::errors::persist_pause_and_send_session_error;
use super::mcp_servers::send_mcp_servers_for_runtime;
use super::prompt_receipt::clear_pending_prompt_receipt;
use super::prompt_resume_resolution::refresh_resume_session_id_from_db;
use super::prompt_status::{
    mark_agent_running, persist_and_publish_prompt, PromptPersistenceOutcome,
};
use super::prompt_worktree::{prepare_branch_provisioning, spawn_auto_name_if_needed};
use super::stream_reader::spawn_stream_reader;
use crate::app_state::AppState;
use crate::domain::agents::adapter::{AgentRuntimeAdapter, RuntimeSpawnConfig};
use crate::domain::agents::runtime_adapter;
use crate::domain::feature_events::FeatureEventAction;
use crate::domain::workflow::worktree;
use crate::domain::ws_session::permissions;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::PromptSendPayload;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tracing::{error, info, warn};
pub(super) struct PendingPromptContext {
    pub envelope_id: String,
    pub sender: WsSender,
    pub sdk_sessions: SdkSessions,
    pub app_state: AppState,
    pub db_session_id: i64,
    pub feature_id: i64,
    pub provider_id: String,
    pub spawned_model: Option<String>,
    pub spawned_thinking_effort: Option<String>,
    pub config: SessionConfig,
    pub options: RuntimeSpawnConfig,
    pub payload: PromptSendPayload,
    pub(super) permission_tx: Option<mpsc::Sender<PermissionResponse>>,
}
pub(super) async fn handle_pending_prompt(mut context: PendingPromptContext) -> Result<(), String> {
    let persistence = persist_initial_user_message(&context).await?;
    if !persistence.should_dispatch() {
        return Ok(());
    }
    let receipt_message_uuid = persistence.tracked_message_uuid(&context.payload);
    let Some(adapter) = resolve_adapter_or_report(&context).await else {
        fail_pending_receipt(&context, receipt_message_uuid.as_deref()).await;
        return Ok(());
    };
    mark_agent_running(
        &context.app_state.write_pool,
        &context.app_state.session_status_tx,
        &context.app_state.active_turns,
        &context.sdk_sessions,
        context.db_session_id,
        context.feature_id,
    )
    .await;
    let auto_name_handled = match prepare_worktree(&mut context).await {
        Ok(handled) => handled,
        Err(error) => {
            fail_pending_receipt(&context, receipt_message_uuid.as_deref()).await;
            report_branch_setup_error(context, error).await;
            return Ok(());
        }
    };
    reresolve_worktree_and_resume(&mut context).await;
    super::prompt_checkpoint::capture_pre_turn_pending(&context, persistence.message_id()).await;
    attach_permission_bridge(&mut context);
    if let Err(error) = super::prompt_pending_mcp::attach_cadencr_mcp(&mut context).await {
        fail_pending_receipt(&context, receipt_message_uuid.as_deref()).await;
        report_spawn_error(context, error).await;
        return Ok(());
    }
    validate_resume_id(adapter, &mut context);
    spawn_runtime(context, adapter, auto_name_handled, receipt_message_uuid).await;
    Ok(())
}
/// Correct stale session state from `session.init` before spawning. When a
/// conversation was started on another device, this connection's `Pending`
/// handle can carry a pre-worktree cwd and no resume id (init ran before the
/// worktree existed / before the runtime session id was persisted). Re-read
/// both from the DB — the source of truth — so a follow-up from any device
/// always resumes the SAME provider session in the SAME worktree instead of
/// starting a fresh agent in the project root.
async fn reresolve_worktree_and_resume(context: &mut PendingPromptContext) {
    if let Some(path) = worktree::get_setting(
        &context.app_state.read_pool,
        context.feature_id,
        "worktree_path",
    )
    .await
    {
        let cwd = std::path::PathBuf::from(&path);
        if !path.is_empty() && context.options.cwd != cwd && cwd.exists() {
            info!(context.db_session_id, worktree_path = %path, "re-resolved worktree cwd from DB before spawn");
            context.config.canonical_cwd = permissions::canonicalize_worktree(&cwd);
            context.config.cwd = cwd.clone();
            context.options.cwd = cwd;
        }
    }
    if let Some(sid) = refresh_resume_session_id_from_db(
        &mut context.options,
        &context.app_state.read_pool,
        context.db_session_id,
        &context.provider_id,
    )
    .await
    {
        info!(context.db_session_id, runtime_session_id = %sid, "re-resolved resume id from DB before spawn");
    }
}
async fn persist_initial_user_message(
    context: &PendingPromptContext,
) -> Result<PromptPersistenceOutcome, String> {
    let attachments = payload_attachments(&context.payload);
    let persist_content = build_persist_content(&context.payload.text, &attachments);
    let outcome = persist_and_publish_prompt(
        &context.app_state.write_pool,
        &context.app_state.ws_feature_senders,
        &context.sender,
        context.feature_id,
        context.db_session_id,
        &context.payload,
        &persist_content,
    )
    .await?;
    if outcome.inserted() {
        context.app_state.feature_events_tx.emit(
            context.feature_id,
            None,
            FeatureEventAction::Reordered,
        );
    }
    Ok(outcome)
}
async fn resolve_adapter_or_report(
    context: &PendingPromptContext,
) -> Option<&'static dyn AgentRuntimeAdapter> {
    match runtime_adapter(&context.provider_id) {
        Some(adapter) => Some(adapter),
        None => {
            let message = format!(
                "No runtime adapter registered for provider '{}'",
                context.provider_id
            );
            persist_pause_and_send_session_error(
                &context.app_state.write_pool,
                &context.app_state.session_status_tx,
                &context.sender,
                &context.envelope_id,
                context.feature_id,
                context.db_session_id,
                "UNSUPPORTED_PROVIDER",
                &message,
            )
            .await;
            None
        }
    }
}
async fn prepare_worktree(context: &mut PendingPromptContext) -> Result<bool, String> {
    prepare_branch_provisioning(
        &context.app_state,
        &context.app_state.write_pool,
        &context.sender,
        &context.payload,
        context.feature_id,
        &mut context.config,
        &mut context.options,
    )
    .await
}
/// Abort the prompt when first-prompt branch setup fails (e.g. the "From
/// branch" `git checkout -b` hit a dirty tree). Pauses the session and surfaces
/// the git error so the agent never runs on an unexpected branch.
async fn report_branch_setup_error(context: PendingPromptContext, message: String) {
    error!(context.db_session_id, error = %message, "branch setup failed before spawn");
    persist_pause_and_send_session_error(
        &context.app_state.write_pool,
        &context.app_state.session_status_tx,
        &context.sender,
        &context.envelope_id,
        context.feature_id,
        context.db_session_id,
        "BRANCH_SETUP_ERROR",
        &message,
    )
    .await;
}
fn attach_permission_bridge(context: &mut PendingPromptContext) {
    let (permission_tx, permission_rx) = mpsc::channel::<PermissionResponse>(16);
    let bridge = WsBridgeCanUseTool {
        app_state: context.app_state.clone(),
        sender: context.sender.clone(),
        feature_senders: context.app_state.ws_feature_senders.clone(),
        response_rx: Arc::new(Mutex::new(permission_rx)),
        feature_id: context.feature_id,
        db_session_id: context.db_session_id,
        write_pool: context.app_state.write_pool.clone(),
        session_status_tx: context.app_state.session_status_tx.clone(),
        sdk_sessions: context.sdk_sessions.clone(),
    };
    context.options.permission_handler = Some(Arc::new(bridge));
    context.permission_tx = Some(permission_tx);
}
fn validate_resume_id(
    adapter: &'static dyn AgentRuntimeAdapter,
    context: &mut PendingPromptContext,
) {
    let Some(ref session_id) = context.options.resume_session_id else {
        return;
    };
    if adapter.is_valid_resume_session_id(session_id) {
        return;
    }
    warn!(
        context.db_session_id,
        resume_session_id = %session_id,
        provider = %context.provider_id,
        "dropping invalid resume_session_id before spawn"
    );
    context.options.resume_session_id = None;
}
async fn spawn_runtime(
    mut context: PendingPromptContext,
    adapter: &'static dyn AgentRuntimeAdapter,
    auto_name_handled: bool,
    receipt_message_uuid: Option<String>,
) {
    info!(
        context.db_session_id,
        prompt = %context.payload.text,
        model = ?context.options.model,
        provider = %context.provider_id,
        mcp_count = context.options.mcp_servers.as_ref().map_or(0, std::collections::HashMap::len),
        mcp_servers = ?context.options.mcp_servers.as_ref().map(|servers| {
            servers.keys().cloned().collect::<Vec<_>>()
        }),
        "spawning runtime query"
    );
    let attachments = payload_attachments(&context.payload);
    // Expand virtual skills for the agent while keeping the short token persisted.
    let prompt_text =
        crate::domain::agents::orchestration_skills::expand_prompt(&context.payload.text);
    let content_value =
        build_content_value_for_provider(&context.provider_id, &prompt_text, &attachments);
    let options = std::mem::take(&mut context.options);
    match adapter.spawn(content_value, options).await {
        Ok(runtime_session) => register_runtime(context, runtime_session, auto_name_handled).await,
        Err(error) => {
            fail_pending_receipt(&context, receipt_message_uuid.as_deref()).await;
            report_spawn_error(context, error.to_string()).await;
        }
    }
}

async fn fail_pending_receipt(context: &PendingPromptContext, message_uuid: Option<&str>) {
    let Some(message_uuid) = message_uuid else {
        return;
    };
    let owner_closed = clear_pending_prompt_receipt(
        &context.app_state.ws_feature_senders,
        &context.sender,
        context.feature_id,
        message_uuid.to_string(),
    )
    .await;
    if owner_closed {
        error!(
            context.db_session_id,
            "prompt delivery-failed receipt owner disconnected"
        );
    }
}

async fn report_spawn_error(context: PendingPromptContext, message: String) {
    error!(context.db_session_id, error = %message, "runtime query spawn failed");
    persist_pause_and_send_session_error(
        &context.app_state.write_pool,
        &context.app_state.session_status_tx,
        &context.sender,
        &context.envelope_id,
        context.feature_id,
        context.db_session_id,
        "SDK_SPAWN_ERROR",
        &message,
    )
    .await;
}

async fn register_runtime(
    mut context: PendingPromptContext,
    mut runtime_session: Box<dyn crate::domain::agents::adapter::AgentRuntimeSession>,
    auto_name_handled: bool,
) {
    info!(
        context.db_session_id,
        "runtime query spawned successfully, starting stream reader"
    );
    let provider_context_window = runtime_session.context_window();
    let runtime_control_endpoint = runtime_session.runtime_control_endpoint();
    if let Some(context_window) = provider_context_window {
        WsSessionPersistence::update_context_window(
            &context.app_state.write_pool,
            context.db_session_id,
            Some(context_window),
        )
        .await;
    }
    if send_mcp_servers_for_runtime(
        &context.sender,
        context.db_session_id,
        runtime_session.as_ref(),
    )
    .await
    .is_err()
    {
        warn!(
            context.db_session_id,
            "websocket sender closed while sending post-spawn MCP servers"
        );
    }

    let message_rx = runtime_session.take_message_rx();
    let query_arc = Arc::new(tokio::sync::RwLock::new(runtime_session));
    let permission_tx = context
        .permission_tx
        .take()
        .expect("permission bridge must be attached before runtime spawn");
    let stream_provider = context.provider_id.clone();
    let stream_model = context.spawned_model.clone();
    let cleanup_session_on_end = Arc::ptr_eq(
        &context.sdk_sessions,
        &context.app_state.mcp_control_sessions,
    );

    spawn_auto_name_if_needed(
        auto_name_handled,
        context.app_state.write_pool.clone(),
        context.app_state.feature_events_tx.clone(),
        context.sender.clone(),
        context.feature_id,
        context.payload.text.clone(),
        context.config.cwd.to_string_lossy().to_string(),
    );
    active_session::insert_active_session(
        &context,
        query_arc,
        permission_tx,
        runtime_control_endpoint,
    )
    .await;
    spawn_stream_reader(
        context.db_session_id,
        context.feature_id,
        message_rx,
        context.sender,
        context.app_state.ws_feature_senders.clone(),
        context.app_state.write_pool.clone(),
        context.app_state.session_status_tx.clone(),
        context.sdk_sessions.clone(),
        stream_provider,
        stream_model.as_deref(),
        provider_context_window,
        context.app_state.clone(),
        cleanup_session_on_end,
    );
}
