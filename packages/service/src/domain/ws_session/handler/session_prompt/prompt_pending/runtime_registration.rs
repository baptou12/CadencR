use std::sync::Arc;

use tracing::{info, warn};

use super::super::mcp_servers::send_mcp_servers_for_runtime;
use super::super::prompt_worktree::spawn_auto_name_if_needed;
use super::super::stream_reader::spawn_stream_reader;
use super::{active_session, PendingPromptContext};
use crate::domain::ws_session::persistence::WsSessionPersistence;

pub(super) async fn register_runtime(
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
