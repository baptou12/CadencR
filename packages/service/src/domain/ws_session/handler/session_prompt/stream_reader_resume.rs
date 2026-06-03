use tracing::info;

use crate::domain::agents::adapter::RuntimeSpawnConfig;

use super::super::{QueryState, SdkSessions};

pub(super) async fn transition_active_to_pending_on_stream_end(
    sdk_sessions: &SdkSessions,
    db_session_id: i64,
) {
    let mut sessions = sdk_sessions.lock().await;
    if let Some(handle) = sessions.get_mut(&db_session_id) {
        if let QueryState::Active { ref query, .. } = handle.state {
            let q = query.read().await;
            let runtime_session_id = q.session_id().await;
            handle.runtime_control_endpoint = q.runtime_control_endpoint();
            drop(q);

            let options = RuntimeSpawnConfig {
                cwd: handle.config.cwd.clone(),
                permission_mode: handle.desired_permission_mode.clone(),
                access_mode: handle.desired_access_mode.clone(),
                model: handle.desired_model.clone(),
                thinking_effort: handle.desired_thinking_effort.clone(),
                system_prompt: handle.config.system_prompt.clone(),
                resume_session_id: runtime_session_id,
                allow_bypass_permissions: handle.config.allow_bypass_permissions,
                env: handle.config.env.clone(),
                ..RuntimeSpawnConfig::default()
            };

            info!(
                db_session_id,
                "stream ended, transitioning Active -> Pending for resume"
            );
            handle.state = QueryState::Pending(options);
        }
    }
}
