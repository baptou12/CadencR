use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use agent_client_protocol::schema::v1::{
    SessionConfigKind, SessionConfigOption, SessionConfigSelectOption, SessionConfigSelectOptions,
};
use async_trait::async_trait;
use serde_json::Value;

use crate::domain::agents::acp::runtime::provider_hooks::{
    AcpExtensionRequest, AcpProviderHooks, AcpServerRequestResolution,
};
use crate::domain::agents::acp::AcpClient;
use crate::domain::agents::adapter::{
    RuntimeAccessMode, RuntimeError, RuntimeEvent, RuntimeEventMetadata, RuntimePermissionDecision,
    RuntimePermissionMode, RuntimePermissionRequest, RuntimePermissionResponse,
    RuntimePermissionResponseKind, RuntimeSlashCommand,
};

use super::extensions;
use super::normalize::{canonical_tool_name, normalize_tool_input};
use super::permission_policy;

const AUTH_TIMEOUT: Duration = Duration::from_secs(60);

pub(super) struct CursorAcpAdapter {
    access_mode: Option<RuntimeAccessMode>,
    plan_requests: Mutex<HashSet<String>>,
    model_config_values: Mutex<HashMap<String, String>>,
}

impl CursorAcpAdapter {
    pub(super) fn new(access_mode: Option<RuntimeAccessMode>) -> Self {
        Self {
            access_mode,
            plan_requests: Mutex::new(HashSet::new()),
            model_config_values: Mutex::new(HashMap::new()),
        }
    }

    fn records_plan_request(&self, request_id: &str) {
        self.plan_requests().insert(request_id.to_string());
    }

    fn plan_requests(&self) -> MutexGuard<'_, HashSet<String>> {
        self.plan_requests
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn model_config_values(&self) -> MutexGuard<'_, HashMap<String, String>> {
        self.model_config_values
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[async_trait]
impl AcpProviderHooks for CursorAcpAdapter {
    async fn authenticate(
        &self,
        client: &AcpClient,
        initialize_response: &Value,
    ) -> Result<(), RuntimeError> {
        if !advertises_cursor_login(initialize_response) {
            return Ok(());
        }
        client
            .request_with_timeout(
                "authenticate",
                serde_json::json!({ "methodId": "cursor_login" }),
                AUTH_TIMEOUT,
            )
            .await
            .map(|_| ())
            .map_err(|error| {
                RuntimeError::new(format!(
                    "Cursor authentication failed; run `agent login`: {error}"
                ))
            })
    }

    fn normalize_tool_name(&self, raw: &str) -> String {
        canonical_tool_name(raw)
    }

    fn normalize_tool_input(&self, tool_name: &str, input: Value) -> Value {
        normalize_tool_input(tool_name, input)
    }

    fn mode_for_permission_mode(&self, mode: RuntimePermissionMode) -> Option<String> {
        Some(match mode {
            RuntimePermissionMode::Plan => "plan".to_string(),
            RuntimePermissionMode::Ask => "ask".to_string(),
            _ => "agent".to_string(),
        })
    }

    fn model_config_id(&self) -> Option<&'static str> {
        Some("model")
    }

    fn observe_session_config_options(&self, options: &[SessionConfigOption]) {
        *self.model_config_values() = cursor_model_config_values(options);
    }

    fn model_config_value(&self, model: &str) -> String {
        self.model_config_values()
            .get(&normalized_model_ref(model))
            .cloned()
            .unwrap_or_else(|| model.to_string())
    }

    fn default_mode_id(&self) -> Option<&'static str> {
        Some("agent")
    }

    fn compact_prompt(&self) -> Option<&'static str> {
        Some("/compress")
    }

    fn supports_durable_resume(&self) -> bool {
        true
    }

    fn extension_request(
        &self,
        request_id: &str,
        method: &str,
        params: &Value,
        metadata: RuntimeEventMetadata,
    ) -> Option<AcpExtensionRequest> {
        let request = extensions::extension_request(request_id, method, params, metadata)?;
        if method == "cursor/create_plan" {
            self.records_plan_request(request_id);
        }
        Some(request)
    }

    fn extension_notification(
        &self,
        method: &str,
        params: &Value,
        metadata: RuntimeEventMetadata,
    ) -> Option<Vec<RuntimeEvent>> {
        extensions::extension_notification(method, params, metadata)
    }

    fn resolve_server_request(
        &self,
        method: &str,
        params: &Value,
        response: &RuntimePermissionResponse,
    ) -> AcpServerRequestResolution {
        if method == "cursor/create_plan" {
            self.plan_requests().remove(&response.request_id);
        }
        let response_payload = extensions::server_request_response(method, params, response)
            .unwrap_or_else(|| {
                crate::domain::agents::acp::runtime::permissions::acp_permission_response_payload(
                    response.decision,
                    response.option_id.as_deref(),
                    response.feedback.as_deref(),
                )
            });
        AcpServerRequestResolution {
            response: response_payload,
            followup: extensions::server_request_followup(method, response),
        }
    }

    fn automatic_permission_decision(
        &self,
        request: &RuntimePermissionRequest,
        params: &Value,
    ) -> Option<RuntimePermissionDecision> {
        permission_policy::automatic_permission_decision(self.access_mode.as_ref(), request, params)
    }

    fn permission_response_kind(&self, request_id: &str) -> RuntimePermissionResponseKind {
        if self.plan_requests().contains(request_id) {
            RuntimePermissionResponseKind::PlanApproval
        } else {
            RuntimePermissionResponseKind::Normal
        }
    }

    async fn record_available_commands(&self, cwd: &Path, commands: Vec<RuntimeSlashCommand>) {
        crate::domain::agents::cursor::commands::record_snapshot(&cwd.to_string_lossy(), commands)
            .await;
    }
}

fn cursor_model_config_values(options: &[SessionConfigOption]) -> HashMap<String, String> {
    let Some(model_option) = options
        .iter()
        .find(|option| option.id.0.as_ref() == "model")
    else {
        return HashMap::new();
    };
    let SessionConfigKind::Select(select) = &model_option.kind else {
        return HashMap::new();
    };
    let mut values = HashMap::new();
    match &select.options {
        SessionConfigSelectOptions::Ungrouped(options) => {
            record_model_options(&mut values, options);
        }
        SessionConfigSelectOptions::Grouped(groups) => {
            for group in groups {
                record_model_options(&mut values, &group.options);
            }
        }
        _ => {}
    }
    values
}

fn record_model_options(
    values: &mut HashMap<String, String>,
    options: &[SessionConfigSelectOption],
) {
    for option in options {
        let value = option.value.0.to_string();
        values.insert(normalized_model_ref(&option.name), value.clone());
        if value.contains("fast=true") {
            values.insert(
                normalized_model_ref(&format!("{}-fast", option.name)),
                value.clone(),
            );
        }
        values.insert(normalized_model_ref(&value), value);
    }
}

fn normalized_model_ref(model: &str) -> String {
    model.trim().to_ascii_lowercase()
}

fn advertises_cursor_login(response: &Value) -> bool {
    response
        .get("authMethods")
        .and_then(Value::as_array)
        .is_some_and(|methods| {
            methods.iter().any(|method| {
                method
                    .get("id")
                    .or_else(|| method.get("methodId"))
                    .and_then(Value::as_str)
                    == Some("cursor_login")
            })
        })
}

#[cfg(test)]
mod tests {
    use super::{advertises_cursor_login, CursorAcpAdapter};
    use crate::domain::agents::acp::runtime::events::session_update_to_events;
    use crate::domain::agents::acp::runtime::events_stream_blocks::EventIndexer;
    use crate::domain::agents::acp::runtime::provider_hooks::AcpProviderHooks;
    use crate::domain::agents::adapter::{
        RuntimeContentBlock, RuntimePermissionDecision, RuntimePermissionMode,
        RuntimePermissionResponse, RuntimePermissionResponseKind, RuntimeStreamEvent,
    };
    use agent_client_protocol::schema::v1::{
        SessionConfigOption, SessionConfigOptionCategory, SessionConfigSelectOption,
    };
    use serde_json::json;

    #[test]
    fn model_config_value_maps_cursor_catalog_ids_to_live_acp_values() {
        let adapter = CursorAcpAdapter::new(None);
        let option = SessionConfigOption::select(
            "model",
            "Model",
            "default[]",
            vec![
                SessionConfigSelectOption::new("default[]", "Auto"),
                SessionConfigSelectOption::new("composer-2.5[fast=true]", "composer-2.5"),
            ],
        )
        .category(SessionConfigOptionCategory::Model);

        adapter.observe_session_config_options(&[option]);

        assert_eq!(adapter.model_config_value("auto"), "default[]");
        assert_eq!(
            adapter.model_config_value("composer-2.5"),
            "composer-2.5[fast=true]"
        );
        assert_eq!(
            adapter.model_config_value("composer-2.5-fast"),
            "composer-2.5[fast=true]"
        );
        assert_eq!(adapter.model_config_value("unknown"), "unknown");
    }

    #[test]
    fn detects_cursor_auth_method() {
        assert!(advertises_cursor_login(&json!({
            "authMethods": [{ "id": "cursor_login", "name": "Cursor" }]
        })));
        assert!(!advertises_cursor_login(&json!({})));
    }

    #[test]
    fn composer_subagent_title_becomes_visible_agent_tool() {
        let adapter = CursorAcpAdapter::new(None);
        let mut indexer = EventIndexer::default();
        let events = session_update_to_events(
            &json!({
                "sessionId": "cursor-session",
                "update": {
                    "sessionUpdate": "tool_call",
                    "toolCallId": "tool-task-1",
                    "title": "Task: Subagent task",
                    "kind": "other",
                    "rawInput": { "_toolName": "task" },
                },
            }),
            &mut indexer,
            None,
            Some("cursor-session"),
            &adapter,
        )
        .events;

        let start = events
            .iter()
            .find_map(|event| event.stream_event())
            .expect("tool start event");
        assert!(matches!(
            start,
            RuntimeStreamEvent::ContentBlockStart {
                block: RuntimeContentBlock::ToolUse { name, input, .. },
                ..
            } if name == "Agent" && input["description"] == "Task: Subagent task"
        ));
        let raw = events.last().expect("mapped event").raw_json();
        assert_eq!(raw["event"]["content_block"]["name"], "Agent");
        assert_eq!(
            raw["event"]["content_block"]["input"]["description"],
            "Task: Subagent task"
        );
    }

    #[test]
    fn maps_runtime_modes_and_compaction() {
        let adapter = CursorAcpAdapter::new(None);
        assert_eq!(
            adapter.mode_for_permission_mode(RuntimePermissionMode::Plan),
            Some("plan".to_string())
        );
        assert_eq!(
            adapter.mode_for_permission_mode(RuntimePermissionMode::AcceptEdits),
            Some("agent".to_string())
        );
        assert_eq!(
            adapter.mode_for_permission_mode(RuntimePermissionMode::Ask),
            Some("ask".to_string())
        );
        assert_eq!(adapter.compact_prompt(), Some("/compress"));
    }

    #[test]
    fn classifies_recorded_plan_requests() {
        let adapter = CursorAcpAdapter::new(None);
        adapter.records_plan_request("plan-1");
        assert_eq!(
            adapter.permission_response_kind("plan-1"),
            RuntimePermissionResponseKind::PlanApproval
        );
        assert_eq!(
            adapter.permission_response_kind("question-1"),
            RuntimePermissionResponseKind::Normal
        );
    }

    #[test]
    fn accepted_plan_queues_backend_owned_followup() {
        let adapter = CursorAcpAdapter::new(None);
        let response = RuntimePermissionResponse {
            request_id: "plan-1".to_string(),
            decision: RuntimePermissionDecision::AllowOnce,
            option_id: None,
            feedback: None,
            updated_input: None,
        };
        let resolution =
            adapter.resolve_server_request("cursor/create_plan", &json!({}), &response);
        assert_eq!(
            resolution.followup,
            Some(json!("Plan approved. Proceed with execution."))
        );
    }
}
