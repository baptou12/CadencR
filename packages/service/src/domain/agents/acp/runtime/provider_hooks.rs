//! Provider-specific extension points for the ACP runtime.
//!
//! Concrete adapters (OpenCode today, future ACP providers tomorrow) implement
//! this trait to plug provider-specific normalization and policy decisions
//! into the otherwise provider-neutral runtime.

use async_trait::async_trait;
use serde_json::Value;

use crate::domain::agents::adapter::{
    RuntimeError, RuntimeEvent, RuntimeEventMetadata, RuntimePermissionDecision,
    RuntimePermissionMode, RuntimePermissionResponse,
};

use super::events_stream_blocks::EventIndexer;

#[async_trait]
pub trait AcpProviderHooks: Send + Sync {
    /// Map a raw ACP `toolName` (often lowercase or aliased) onto the
    /// canonical Cadencr Pascal-case tool name.
    fn normalize_tool_name(&self, raw: &str) -> String;

    /// Massage the tool input JSON for a known tool (e.g. rewriting OpenCode's
    /// `oldText`/`newText` into `old_string`/`new_string`).
    fn normalize_tool_input(&self, tool_name: &str, input: Value) -> Value;

    /// Reduce ACP `ToolCallContent[]` to a shape the FE renders directly.
    /// Most providers can rely on the default flatten that joins text blocks;
    /// some (OpenCode) wrap text in a `{type: "content"}` envelope and need
    /// to unwrap before flattening.
    fn flatten_tool_result_content(&self, blocks: &[Value]) -> Value;

    /// Turn an ACP option `kind` (`allow_once`, `allow_always`, …) into a
    /// runtime decision — provider can rename kinds.
    #[allow(dead_code)]
    fn permission_decision_for_kind(&self, kind: &str) -> RuntimePermissionDecision;

    /// Map a Cadencr permission mode onto the provider's mode id (OpenCode
    /// uses `"plan"` / `"build"`; other ACP providers may have different
    /// mode catalogs). Returning `None` means "this mode is not supported".
    fn mode_for_permission_mode(&self, mode: RuntimePermissionMode) -> Option<&'static str>;

    /// Optionally decorate the system prompt the agent will receive.
    #[allow(dead_code)]
    fn decorate_system_prompt(&self, base: Option<&str>) -> Option<String>;

    /// Provider-specific hook for `AskUserQuestion`-style tool calls. Returns
    /// `Some(event)` to short-circuit the normal `tool_call` start mapping
    /// (e.g. emit a permission/question event instead). Returning `None`
    /// lets the runtime continue with the default tool-call event flow.
    ///
    /// Default implementation: no override.
    fn tool_call_start_override(
        &self,
        _tool_call_id: &str,
        _tool_name: &str,
        _tool_input: &Value,
        _metadata: &RuntimeEventMetadata,
        _parent_tool_use_id: Option<&str>,
        _indexer: &mut EventIndexer,
    ) -> Option<RuntimeEvent> {
        None
    }

    /// Provider-specific hook for `tool_call_update` payloads. Returns
    /// `Some(event)` to short-circuit normal update handling — used by
    /// providers (OpenCode) where the question payload only arrives in the
    /// update, never in the original start.
    fn tool_call_update_override(
        &self,
        _tool_call_id: &str,
        _body: &Value,
        _status: &str,
        _metadata: &RuntimeEventMetadata,
        _parent_tool_use_id: Option<&str>,
        _indexer: &mut EventIndexer,
    ) -> Option<RuntimeEvent> {
        None
    }

    /// Last-resort hook for permission responses that don't match a pending
    /// ACP server request. OpenCode uses this to forward question-tool
    /// answers to its sidecar HTTP endpoint. Returning `Ok(true)` means
    /// "I handled this"; `Ok(false)` means "let the runtime surface a
    /// no-such-pending error".
    async fn respond_permission_fallback(
        &self,
        _response: RuntimePermissionResponse,
    ) -> Result<bool, RuntimeError> {
        Ok(false)
    }
}
