//! Apply a catalog model id through ACP `session/set_config_option`, then any
//! provider companion options (Cursor `fast` / thought-level params).

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use agent_client_protocol::schema::v1::SessionConfigOption;
use serde_json::Value;
use tokio::sync::RwLock;

use crate::domain::agents::acp::runtime::provider_hooks::AcpProviderHooks;
use crate::domain::agents::acp::AcpClient;
use crate::domain::agents::adapter::RuntimeError;

use super::config_options::{
    send_set_config_option, set_config_option_model_value, set_config_option_thinking_effort,
};
use super::thought_level::is_thought_level_config_name;

pub async fn apply_model_config(
    client: &AcpClient,
    session_id: &str,
    current_model: &Arc<RwLock<Option<String>>>,
    current_effort: &Arc<RwLock<Option<String>>>,
    supports_flag: &Arc<AtomicBool>,
    hooks: &dyn AcpProviderHooks,
    model: &str,
) -> Result<(), RuntimeError> {
    let (config_value, companions) = hooks.resolve_model_config(model);
    let result = set_config_option_model_value(
        client,
        session_id,
        current_model,
        supports_flag,
        hooks.model_config_id(),
        model,
        &config_value,
    )
    .await?;
    if let Some(result) = result.as_ref() {
        match config_options_from_result(result) {
            Some(options) => hooks.observe_session_config_options(&options),
            None if result.get("configOptions").is_some() => {
                tracing::debug!("failed to deserialize ACP set_config_option configOptions");
            }
            None => {}
        }
    }
    let effort_config_id = hooks.thinking_effort_config_id();
    for (config_id, value) in companions {
        let is_effort = effort_config_id.as_deref() == Some(config_id.as_str())
            || is_thought_level_config_name(&config_id);
        if is_effort {
            set_config_option_thinking_effort(
                client,
                session_id,
                current_effort,
                supports_flag,
                Some(config_id),
                Some(&value),
            )
            .await?;
        } else {
            send_set_config_option(client, session_id, supports_flag, &config_id, Some(&value))
                .await?;
        }
    }
    Ok(())
}

fn config_options_from_result(result: &Value) -> Option<Vec<SessionConfigOption>> {
    let options = result.get("configOptions")?;
    serde_json::from_value(options.clone()).ok()
}
