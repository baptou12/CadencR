//! Provider-specific ACP adapter for OpenCode.
//!
//! Plugs OpenCode-specific normalization into the shared `AcpProviderHooks`
//! trait. Lives next to the OpenCode HTTP code so OpenCode-only quirks stay
//! out of the provider-neutral runtime.

use async_trait::async_trait;
use serde_json::{json, Value};

use crate::domain::agents::acp::runtime::events_stream_blocks::EventIndexer;
use crate::domain::agents::acp::runtime::provider_hooks::AcpProviderHooks;
use crate::domain::agents::adapter::{
    RuntimeError, RuntimeEvent, RuntimeEventMetadata, RuntimePermissionDecision,
    RuntimePermissionMode, RuntimePermissionResponse,
};
use crate::domain::agents::opencode::questions::extract_question_answers;
use crate::domain::agents::opencode::tool_names::{
    canonical_acp_tool_name, canonical_cadencr_tool_name,
};

use super::adapter_normalize::normalize_edit_input;
use super::events_tool_call_question::{question_start_event, question_update_event};
use super::question_sidecar::QuestionSidecar;

/// OpenCode-specific implementation of [`AcpProviderHooks`].
pub struct OpenCodeAcpAdapter {
    question_sidecar: QuestionSidecar,
}

impl OpenCodeAcpAdapter {
    pub fn new(question_sidecar: QuestionSidecar) -> Self {
        Self { question_sidecar }
    }
}

#[async_trait]
impl AcpProviderHooks for OpenCodeAcpAdapter {
    fn normalize_tool_name(&self, raw: &str) -> String {
        // OpenCode emits lowercase tool kinds (`write`, `edit`, `bash`); the
        // FE matches Pascal-case names. Then run the Cadencr-MCP rewrite the
        // HTTP path also uses for `cadencr-<server>_<tool>` →
        // `mcp__cadencr-…`.
        canonical_cadencr_tool_name(&canonical_acp_tool_name(raw))
    }

    fn normalize_tool_input(&self, tool_name: &str, input: Value) -> Value {
        normalize_edit_input(tool_name, input)
    }

    fn flatten_tool_result_content(&self, blocks: &[Value]) -> Value {
        flatten_tool_result_content(blocks)
    }

    fn permission_decision_for_kind(&self, kind: &str) -> RuntimePermissionDecision {
        // OpenCode follows the canonical ACP option kinds. We surface the
        // session-vs-always split as distinct decisions so the runtime
        // routes the right `optionId` back to the agent — collapsing them
        // here would silently turn a "session" approval into a persistent
        // grant.
        match kind {
            "allow_once" => RuntimePermissionDecision::AllowOnce,
            "allow_for_session" => RuntimePermissionDecision::AllowForSession,
            "allow_always" => RuntimePermissionDecision::AllowFuture,
            "reject_once" | "reject_always" => RuntimePermissionDecision::Deny,
            other => {
                tracing::warn!(
                    kind = other,
                    "unknown ACP permission option kind; falling back to reject"
                );
                RuntimePermissionDecision::Deny
            }
        }
    }

    fn mode_for_permission_mode(&self, mode: RuntimePermissionMode) -> Option<&'static str> {
        // OpenCode primary agents are `build` (default/acceptEdits) and `plan`.
        // `supports_permission_mode` already restricts the public surface to
        // {Default, AcceptEdits, Plan}; map defensively otherwise.
        Some(match mode {
            RuntimePermissionMode::Plan => "plan",
            _ => "build",
        })
    }

    fn decorate_system_prompt(&self, _base: Option<&str>) -> Option<String> {
        None
    }

    fn tool_call_start_override(
        &self,
        tool_call_id: &str,
        tool_name: &str,
        tool_input: &Value,
        metadata: &RuntimeEventMetadata,
        parent_tool_use_id: Option<&str>,
        indexer: &mut EventIndexer,
    ) -> Option<RuntimeEvent> {
        if tool_name != "AskUserQuestion" {
            return None;
        }
        question_start_event(
            tool_call_id,
            tool_input.clone(),
            metadata.clone(),
            parent_tool_use_id.map(ToOwned::to_owned),
            indexer,
        )
    }

    fn tool_call_update_override(
        &self,
        tool_call_id: &str,
        body: &Value,
        status: &str,
        metadata: &RuntimeEventMetadata,
        parent_tool_use_id: Option<&str>,
        indexer: &mut EventIndexer,
    ) -> Option<RuntimeEvent> {
        question_update_event(
            tool_call_id,
            body,
            status,
            metadata.clone(),
            parent_tool_use_id.map(ToOwned::to_owned),
            indexer,
        )
    }

    async fn respond_permission_fallback(
        &self,
        response: RuntimePermissionResponse,
    ) -> Result<bool, RuntimeError> {
        if response.updated_input.is_none() && response.feedback.is_none() {
            return Ok(false);
        }
        if matches!(response.decision, RuntimePermissionDecision::Deny) {
            self.question_sidecar
                .reject_tool_call(&response.request_id)
                .await?;
            return Ok(true);
        }
        let answers = extract_question_answers(
            response.updated_input.as_ref(),
            response.feedback.as_deref(),
        );
        if answers.iter().all(Vec::is_empty) {
            return Ok(false);
        }
        self.question_sidecar
            .reply_tool_call(&response.request_id, answers)
            .await?;
        Ok(true)
    }
}

/// Reduce ACP `ToolCallContent[]` to a shape the Cadencr frontend can
/// render directly:
/// - All text-bearing blocks → joined string.
/// - Otherwise, pass the array through unchanged.
///
/// OpenCode wraps text in a `{type:"content", content:{type:"text", text}}`
/// envelope rather than the bare `{type:"text", text}` ACP defines, so we
/// unwrap recursively before deciding whether the array is text-only.
pub fn flatten_tool_result_content(content: &[Value]) -> Value {
    let texts: Option<Vec<String>> = content.iter().map(unwrap_text_block).collect();
    if let Some(texts) = texts {
        if !texts.is_empty() {
            return Value::String(texts.join("\n"));
        }
    }
    json!(content)
}

fn unwrap_text_block(block: &Value) -> Option<String> {
    let kind = block.get("type").and_then(Value::as_str)?;
    match kind {
        "text" => block
            .get("text")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        "content" => block
            .get("content")
            .and_then(|inner| unwrap_text_block(inner)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{flatten_tool_result_content, OpenCodeAcpAdapter};
    use crate::domain::agents::acp::runtime::events_stream_blocks::EventIndexer;
    use crate::domain::agents::acp::runtime::provider_hooks::AcpProviderHooks;
    use crate::domain::agents::adapter::RuntimeEventMetadata;
    use serde_json::json;

    fn metadata() -> RuntimeEventMetadata {
        RuntimeEventMetadata {
            raw: json!({}),
            ..RuntimeEventMetadata::default()
        }
    }

    fn adapter() -> OpenCodeAcpAdapter {
        OpenCodeAcpAdapter::new(super::QuestionSidecar::new(0, std::path::Path::new("/tmp")))
    }

    #[test]
    fn flatten_collapses_text_only_blocks_into_a_string() {
        let payload = flatten_tool_result_content(&[
            json!({ "type": "text", "text": "line one" }),
            json!({ "type": "text", "text": "line two" }),
        ]);
        assert_eq!(payload, json!("line one\nline two"));
    }

    #[test]
    fn flatten_passes_structured_blocks_through() {
        let blocks = vec![json!({ "type": "diff", "path": "/x", "newText": "x" })];
        let payload = flatten_tool_result_content(&blocks);
        assert!(payload.is_array());
        assert_eq!(payload[0]["type"], "diff");
    }

    #[test]
    fn flatten_returns_empty_array_for_empty_input() {
        let payload = flatten_tool_result_content(&[]);
        assert!(payload.is_array());
        assert_eq!(payload.as_array().unwrap().len(), 0);
    }

    #[test]
    fn flatten_unwraps_opencode_content_envelope() {
        let payload = flatten_tool_result_content(&[json!({
            "type": "content",
            "content": { "type": "text", "text": "(no output)" }
        })]);
        assert_eq!(payload, json!("(no output)"));
    }

    #[test]
    fn flatten_handles_mixed_envelope_and_bare_text() {
        let payload = flatten_tool_result_content(&[
            json!({ "type": "content", "content": { "type": "text", "text": "first" } }),
            json!({ "type": "text", "text": "second" }),
        ]);
        assert_eq!(payload, json!("first\nsecond"));
    }

    #[test]
    fn adapter_normalizes_lowercase_acp_tool_names() {
        let adapter = adapter();
        assert_eq!(adapter.normalize_tool_name("write"), "Write");
        assert_eq!(adapter.normalize_tool_name("question"), "AskUserQuestion");
        assert_eq!(
            adapter.normalize_tool_name("cadencr-plan_update_plan"),
            "mcp__cadencr-plan__update_plan"
        );
    }

    #[test]
    fn adapter_normalize_tool_input_renames_edit_keys() {
        let adapter = adapter();
        let value = adapter.normalize_tool_input(
            "Edit",
            json!({ "path": "/x", "oldText": "a", "newText": "b" }),
        );
        assert_eq!(value["file_path"], "/x");
        assert_eq!(value["old_string"], "a");
        assert_eq!(value["new_string"], "b");
    }

    #[test]
    fn tool_call_start_override_swallows_empty_question_payload() {
        let adapter = adapter();
        let mut idx = EventIndexer::default();
        let event = adapter.tool_call_start_override(
            "q-1",
            "AskUserQuestion",
            &json!({}),
            &metadata(),
            None,
            &mut idx,
        );
        assert!(event.is_none());
    }

    #[test]
    fn tool_call_update_override_emits_permission_event_with_real_payload() {
        let adapter = adapter();
        let mut idx = EventIndexer::default();
        let event = adapter
            .tool_call_update_override(
                "q-2",
                &json!({
                    "rawInput": {
                        "questions": [{ "question": "Pick", "options": [] }]
                    }
                }),
                "in_progress",
                &metadata(),
                None,
                &mut idx,
            )
            .expect("event");
        let raw = event.raw_json();
        assert_eq!(raw["type"], "opencode_permission_request");
        assert_eq!(raw["tool_name"], "AskUserQuestion");
    }

    #[test]
    fn question_completed_update_does_not_reopen_question() {
        let adapter = adapter();
        let mut idx = EventIndexer::default();
        let event = adapter.tool_call_update_override(
            "q-3",
            &json!({
                "rawInput": {
                    "questions": [{ "question": "Pick" }]
                }
            }),
            "completed",
            &metadata(),
            None,
            &mut idx,
        );
        assert!(event.is_none());
    }
}
