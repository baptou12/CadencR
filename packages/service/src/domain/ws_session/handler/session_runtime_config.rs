use crate::app_state::AppState;
use crate::domain::agents::adapter::{RuntimePermissionMode, RuntimeSpawnConfig};

use super::default_permission_mode;

pub(super) async fn apply_claude_settings(
    app_state: &AppState,
    project_id: i64,
    feature_id: i64,
    db_session_id: i64,
    provider: &str,
    stored_profile: Option<&str>,
    runtime_config: &mut RuntimeSpawnConfig,
) -> Option<String> {
    if provider != crate::domain::agents::claude_code::PROVIDER_ID {
        return None;
    }

    let allow_bypass = super::claude_access::bypass_permissions_enabled(
        &app_state.read_pool,
        Some(feature_id),
        Some(project_id),
    );
    let profile = super::session_profile::resolve_initial_claude_profile(
        app_state,
        db_session_id,
        stored_profile,
    );
    let ((profile_name, profile_env), allow_bypass_permissions) =
        tokio::join!(profile, allow_bypass);
    runtime_config.env = profile_env;
    runtime_config.allow_bypass_permissions = allow_bypass_permissions;

    if !allow_bypass_permissions
        && runtime_config.permission_mode == Some(RuntimePermissionMode::BypassPermissions)
    {
        tracing::warn!(
            db_session_id,
            feature_id,
            "bypassPermissions requested without claude_bypass_permissions_enabled; \
             downgrading to provider default"
        );
        runtime_config.permission_mode = Some(default_permission_mode(provider));
    }

    Some(profile_name)
}
