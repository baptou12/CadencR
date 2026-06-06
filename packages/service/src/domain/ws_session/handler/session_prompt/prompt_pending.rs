use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};
use tracing::{error, info, warn};

use crate::app_state::AppState;
use crate::domain::agents::adapter::{AgentRuntimeAdapter, RuntimeSpawnConfig};
use crate::domain::agents::runtime_adapter;
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::PromptSendPayload;

use super::super::{QueryState, SdkHandle, SdkSessions, SessionConfig, WsSender};
use super::bridge::{
    build_content_value, build_persist_content, PermissionResponse, WsBridgeCanUseTool,
};
use super::errors::persist_pause_and_send_session_error;
use super::mcp_servers::send_mcp_servers_for_runtime;
use super::prompt_status::{mark_agent_running, mirror_user_message};
use super::prompt_worktree::{prepare_worktree_if_requested, spawn_auto_name_if_needed};
use super::stream_reader::spawn_stream_reader;

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

pub(super) async fn handle_pending_prompt(mut context: PendingPromptContext) {
    persist_initial_user_message(&context).await;
    let Some(adapter) = resolve_adapter_or_report(&context).await else {
        return;
    };
    mark_agent_running(
        &context.app_state.write_pool,
        &context.app_state.session_status_tx,
        context.db_session_id,
        context.feature_id,
    )
    .await;
    let use_worktree = prepare_worktree(&mut context).await;
    attach_permission_bridge(&mut context);
    validate_resume_id(adapter, &mut context);
    spawn_runtime(context, adapter, use_worktree).await;
}

async fn persist_initial_user_message(context: &PendingPromptContext) {
    if context.payload.replay {
        return;
    }
    let persist_content = build_persist_content(&context.payload.text, &context.payload.images);
    let persistence = WsSessionPersistence::with_session_id(
        context.app_state.write_pool.clone(),
        context.feature_id,
        Some(context.db_session_id),
    );
    persistence.persist_user_message(&persist_content).await;
    mirror_user_message(
        &context.app_state.ws_feature_senders,
        &context.sender,
        context.feature_id,
        &persist_content,
    )
    .await;
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

async fn prepare_worktree(context: &mut PendingPromptContext) -> bool {
    prepare_worktree_if_requested(
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

fn attach_permission_bridge(context: &mut PendingPromptContext) {
    let (permission_tx, permission_rx) = mpsc::channel::<PermissionResponse>(16);
    let bridge = WsBridgeCanUseTool {
        sender: context.sender.clone(),
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
    use_worktree: bool,
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
    let content_value = build_content_value(&context.payload.text, &context.payload.images);
    let options = std::mem::take(&mut context.options);
    match adapter.spawn(content_value, options).await {
        Ok(runtime_session) => register_runtime(context, runtime_session, use_worktree).await,
        Err(error) => report_spawn_error(context, error.to_string()).await,
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
    use_worktree: bool,
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

    spawn_auto_name_if_needed(
        use_worktree,
        context.app_state.write_pool.clone(),
        context.sender.clone(),
        context.feature_id,
        context.payload.text.clone(),
        context.config.cwd.to_string_lossy().to_string(),
    );
    insert_active_session(&context, query_arc, permission_tx, runtime_control_endpoint).await;
    spawn_stream_reader(
        context.db_session_id,
        context.feature_id,
        message_rx,
        context.sender,
        context.app_state.ws_feature_senders.clone(),
        context.app_state.write_pool,
        context.app_state.session_status_tx,
        context.sdk_sessions,
        stream_provider,
        stream_model.as_deref(),
        provider_context_window,
    );
}

async fn insert_active_session(
    context: &PendingPromptContext,
    query: crate::domain::agents::adapter::RuntimeSessionHandle,
    permission_tx: mpsc::Sender<PermissionResponse>,
    runtime_control_endpoint: Option<String>,
) {
    let spawned_permission_mode = context.config.permission_mode.clone();
    let spawned_access_mode = context.config.access_mode.clone();
    let spawned_effort = context.spawned_thinking_effort.clone();
    let mut sessions = context.sdk_sessions.lock().await;
    sessions.insert(
        context.db_session_id,
        SdkHandle {
            state: QueryState::Active {
                query,
                permission_tx,
            },
            feature_id: context.feature_id,
            runtime_provider: context.provider_id.clone(),
            desired_model: context.spawned_model.clone(),
            spawned_model: context.spawned_model.clone(),
            desired_permission_mode: spawned_permission_mode.clone(),
            spawned_permission_mode,
            desired_access_mode: spawned_access_mode.clone(),
            spawned_access_mode,
            desired_thinking_effort: spawned_effort.clone(),
            spawned_thinking_effort: spawned_effort,
            runtime_control_endpoint,
            resume_session_id: None,
            config: context.config.clone(),
            manual_compact_cancel: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            manual_compact_spawn_pending: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        },
    );
}
