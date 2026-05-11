//! Provider-specific ACP adapter for OpenCode.
//!
//! Plugs OpenCode-specific normalization into the shared `AcpProviderHooks`
//! trait. Lives next to the OpenCode HTTP code so OpenCode-only quirks stay
//! out of the provider-neutral runtime.

use std::collections::VecDeque;
use std::path::Path;
use std::sync::{Arc, Mutex as StdMutex};

use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::domain::agents::acp::runtime::events_stream_blocks::EventIndexer;
use crate::domain::agents::acp::runtime::provider_hooks::{
    flatten_tool_result_content_with, AcpProviderHooks,
};
use crate::domain::agents::adapter::{
    RuntimeError, RuntimeEvent, RuntimeEventMetadata, RuntimePermissionDecision,
    RuntimePermissionMode, RuntimePermissionResponse, RuntimeSlashCommand,
};
use crate::domain::agents::opencode::questions::extract_question_answers;
use crate::domain::agents::opencode::tool_names::{
    canonical_acp_tool_name, canonical_cadencr_tool_name,
};

use super::adapter_normalize::normalize_edit_input;
use super::events_subagent_synthesis::{extract_subagent_body, synthesize_subagent_text_event};
use super::events_tool_call_question::{question_start_event, question_update_event};
use super::question_sidecar::QuestionSidecar;
use super::upstream_workaround::{spawn_subagent_listener, PendingSubagentTasks};

/// OpenCode-specific implementation of [`AcpProviderHooks`].
pub struct OpenCodeAcpAdapter {
    question_sidecar: QuestionSidecar,
    /// Port of the OpenCode HTTP backend running inside the `opencode acp`
    /// subprocess. We hand this to the SSE side-channel listener so it can
    /// subscribe to all session events (including child sub-agent sessions
    /// the ACP transport itself silently drops).
    opencode_http_port: u16,
    /// FIFO of `Task`/`Agent` tool_call ids the FE has seen via the ACP wire
    /// but whose child session id we don't yet know. The SSE listener pops
    /// from here when a `SessionCreated` arrives with `parent_id == root` so
    /// freshly-spawned child sessions inherit the right `parent_tool_use_id`.
    pending_subagent_calls: PendingSubagentTasks,
}

impl OpenCodeAcpAdapter {
    pub fn new(question_sidecar: QuestionSidecar, opencode_http_port: u16) -> Self {
        Self {
            question_sidecar,
            opencode_http_port,
            pending_subagent_calls: Arc::new(StdMutex::new(VecDeque::new())),
        }
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

    fn mode_for_permission_mode(&self, mode: RuntimePermissionMode) -> Option<&'static str> {
        // OpenCode primary agents are `build` (default/acceptEdits) and `plan`.
        // `supports_permission_mode` already restricts the public surface to
        // {Default, AcceptEdits, Plan}; map defensively otherwise.
        Some(match mode {
            RuntimePermissionMode::Plan => "plan",
            _ => "build",
        })
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

    /// OpenCode delivers the entire `Task` / `Agent` sub-agent result as a
    /// single `{metadata, output: "task_id: …<task_result>…</task_result>"}`
    /// envelope on the parent `tool_call_update`. Surfacing that raw blob
    /// produces a JSON dump in the chat alongside an empty Task block. We
    /// suppress the default tool_result emission here and let
    /// `synthesize_tool_call_completion` render the cleaned body as a child
    /// Text block under the parent tool_use_id instead.
    fn suppresses_raw_output(&self, tool_name: &str) -> bool {
        matches!(tool_name, "Task" | "Agent")
    }

    /// On a completed `Task` / `Agent` update, build a synthetic
    /// `AssistantMessage` whose `parent_tool_use_id` is the parent Task's
    /// `tool_call_id`. The FE's existing nesting path renders it as a child
    /// Text block inside the Task block.
    ///
    /// OpenCode does not stream the sub-agent's intermediate events (no
    /// `session/update` notifications are keyed to the sub-agent session id;
    /// the sub-agent session id only appears in `rawOutput.metadata`), so
    /// this synthesis is the only path by which the user sees what the
    /// sub-agent produced.
    fn synthesize_tool_call_completion(
        &self,
        tool_call_id: &str,
        tool_name: &str,
        body: &Value,
        _status: &str,
        metadata: &RuntimeEventMetadata,
        _indexer: &mut EventIndexer,
    ) -> Vec<RuntimeEvent> {
        if !matches!(tool_name, "Task" | "Agent") {
            return Vec::new();
        }
        let Some(body_text) = extract_subagent_body(body) else {
            return Vec::new();
        };
        vec![synthesize_subagent_text_event(
            metadata,
            tool_call_id,
            &body_text,
        )]
    }

    fn record_tool_call_start(&self, tool_call_id: &str, tool_name: &str) {
        // Track Task/Agent calls so the SSE listener can pair them with the
        // child session OpenCode is about to spawn. We hold the lock only
        // long enough to push; the listener pops the same lock from its task.
        if matches!(tool_name, "Task" | "Agent") {
            if let Ok(mut queue) = self.pending_subagent_calls.lock() {
                queue.push_back(tool_call_id.to_string());
            }
        }
    }

    fn start_side_channel(
        &self,
        session_id: &str,
        cwd: &Path,
        tx: mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    ) -> Option<JoinHandle<()>> {
        Some(spawn_subagent_listener(
            self.opencode_http_port,
            cwd.to_path_buf(),
            session_id.to_string(),
            Arc::clone(&self.pending_subagent_calls),
            tx,
        ))
    }

    async fn record_available_commands(&self, cwd: &Path, commands: Vec<RuntimeSlashCommand>) {
        // Mirror the ACP-pushed catalog into the per-cwd snapshot the
        // synchronous WS `commands.get` request reads back through the
        // adapter's `runtime_slash_commands(cwd)`.
        let cwd = cwd.to_string_lossy().into_owned();
        crate::domain::agents::opencode::commands::record_snapshot(&cwd, commands).await;
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
    flatten_tool_result_content_with(content, unwrap_text_block)
}

fn unwrap_text_block(block: &Value) -> Option<&str> {
    let kind = block.get("type").and_then(Value::as_str)?;
    match kind {
        "text" => block.get("text").and_then(Value::as_str),
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
    use crate::domain::agents::adapter::{RuntimeContentBlock, RuntimeEventMetadata};
    use serde_json::json;

    fn metadata() -> RuntimeEventMetadata {
        RuntimeEventMetadata {
            raw: json!({}),
            ..RuntimeEventMetadata::default()
        }
    }

    fn adapter() -> OpenCodeAcpAdapter {
        OpenCodeAcpAdapter::new(
            super::QuestionSidecar::new(0, std::path::Path::new("/tmp")),
            // Tests don't actually exercise the SSE side channel; any port is
            // fine because the listener is only spawned by `start_side_channel`,
            // which the unit tests don't call.
            0,
        )
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
    fn suppresses_raw_output_for_task_and_agent_only() {
        let adapter = adapter();
        assert!(adapter.suppresses_raw_output("Task"));
        assert!(adapter.suppresses_raw_output("Agent"));
        assert!(!adapter.suppresses_raw_output("Bash"));
        assert!(!adapter.suppresses_raw_output("Write"));
    }

    #[test]
    fn synthesize_tool_call_completion_emits_text_under_parent_for_task() {
        // Real wire shape captured on a sub-agent run (see plan):
        //   tool_call_update completed → content[0] = {type:"content", content:{type:"text", text:"task_id: …<task_result>body</task_result>"}}
        //   plus rawOutput.{output, metadata.sessionId}.
        let adapter = adapter();
        let mut idx = EventIndexer::default();
        let body = json!({
            "toolCallId": "call_TASK_PARENT",
            "status": "completed",
            "content": [{
                "type": "content",
                "content": {
                    "type": "text",
                    "text": "task_id: ses_child\n\n<task_result>\nfindings line 1\nfindings line 2\n</task_result>"
                }
            }],
            "rawOutput": {
                "output": "task_id: ses_child\n\n<task_result>\nfindings line 1\nfindings line 2\n</task_result>",
                "metadata": { "sessionId": "ses_child", "model": { "modelID": "gpt-5.4" } }
            }
        });
        let events = adapter.synthesize_tool_call_completion(
            "call_TASK_PARENT",
            "Task",
            &body,
            "completed",
            &metadata(),
            &mut idx,
        );
        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(event.parent_tool_use_id(), Some("call_TASK_PARENT"));
        let assistant = event.assistant_message().expect("assistant message");
        let RuntimeContentBlock::Text { text } = &assistant.content[0] else {
            panic!("expected text block");
        };
        assert_eq!(text, "findings line 1\nfindings line 2");
    }

    #[test]
    fn synthesize_tool_call_completion_returns_empty_for_non_subagent_tools() {
        let adapter = adapter();
        let mut idx = EventIndexer::default();
        let body = json!({
            "toolCallId": "call_BASH",
            "status": "completed",
            "rawOutput": { "output": "ls -la output" }
        });
        let events = adapter.synthesize_tool_call_completion(
            "call_BASH",
            "Bash",
            &body,
            "completed",
            &metadata(),
            &mut idx,
        );
        assert!(events.is_empty());
    }

    #[test]
    fn synthesize_tool_call_completion_returns_empty_when_body_is_blank() {
        let adapter = adapter();
        let mut idx = EventIndexer::default();
        let body = json!({
            "toolCallId": "call_TASK",
            "status": "completed",
            "rawOutput": { "output": "" }
        });
        let events = adapter.synthesize_tool_call_completion(
            "call_TASK",
            "Task",
            &body,
            "completed",
            &metadata(),
            &mut idx,
        );
        assert!(events.is_empty());
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
