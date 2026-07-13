use crate::app_state::AppState;
use crate::domain::ws_session::protocol::WsEnvelope;

use super::super::{SdkSessions, WsSender};
use super::prompt_send::{
    dispatch_local_phase, dispatch_owner_phase, prepare_prompt, spawn_pending_prompt,
};

/// Handle `session.prompt.send` through local, remote-owner, then spawn phases.
pub(crate) async fn handle_prompt_send(
    envelope: WsEnvelope,
    sender: &WsSender,
    sdk_sessions: &SdkSessions,
    app_state: &AppState,
) {
    let Some(prepared) = prepare_prompt(&envelope, sender, sdk_sessions, app_state).await else {
        return;
    };
    let Some(payload) = dispatch_local_phase(
        &envelope,
        sender,
        sdk_sessions,
        app_state,
        prepared.db_session_id,
        prepared.payload,
        prepared.profile_update.as_ref(),
    )
    .await
    else {
        return;
    };
    let Some(payload) = dispatch_owner_phase(
        &envelope,
        sender,
        app_state,
        prepared.db_session_id,
        payload,
        prepared.profile_update.as_ref(),
    )
    .await
    else {
        return;
    };
    spawn_pending_prompt(
        &envelope,
        sender,
        sdk_sessions,
        app_state,
        prepared.db_session_id,
        payload,
    )
    .await;
}
