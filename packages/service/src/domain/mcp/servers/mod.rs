pub mod composable;
pub mod plan;
pub mod session;
pub mod tool_handlers;

use std::sync::Arc;

use rmcp::model::{Implementation, ServerCapabilities, ServerInfo, Tool};
use serde_json::json;

use self::{composable::ComposableServer, plan::PlanServer, session::SessionServer};
use super::context::McpContext;

/// Agent types that can be served
#[derive(Debug, Clone, Copy)]
pub enum AgentType {
    Plan,
    Prd,
    Execute,
    Qa,
    Review,
    Risk,
    Retro,
    Session,
}

impl AgentType {
    pub const ALL: &'static [AgentType] = &[
        AgentType::Plan,
        AgentType::Prd,
        AgentType::Execute,
        AgentType::Qa,
        AgentType::Review,
        AgentType::Risk,
        AgentType::Retro,
        AgentType::Session,
    ];

    /// Short identifier used in `opencode.json` permission keys and DB rows
    /// (the suffix after `cadence-` in `mcp_server_name`).
    pub fn short_name(self) -> &'static str {
        match self {
            Self::Plan => "plan",
            Self::Prd => "prd",
            Self::Execute => "execute",
            Self::Qa => "qa",
            Self::Review => "review",
            Self::Risk => "risk",
            Self::Retro => "retro",
            Self::Session => "session",
        }
    }
}

impl std::str::FromStr for AgentType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        AgentType::ALL
            .iter()
            .copied()
            .find(|t| t.short_name() == s)
            .ok_or_else(|| format!("Unknown agent type: {s}"))
    }
}

/// A type-erased MCP server wrapper that can hold any agent server type.
/// Needed because `ServerHandler` is not dyn-compatible (requires `Self: Sized`).
pub enum McpServer {
    Composable(ComposableServer),
    Plan(PlanServer),
    Session(SessionServer),
}

/// Create the appropriate MCP server for the given agent type.
pub fn create_mcp_server(agent_type: AgentType, ctx: Arc<McpContext>) -> McpServer {
    use tool_handlers as th;

    match agent_type {
        AgentType::Plan => McpServer::Plan(PlanServer::new(ctx)),
        AgentType::Session => McpServer::Session(SessionServer::new(ctx)),
        AgentType::Prd => McpServer::Composable(ComposableServer::new(
            "cadence-prd",
            vec![
                th::create_prd(&ctx),
                th::edit_prd(&ctx),
                th::show_prd(&ctx),
                th::mark_agent_done(&ctx),
            ],
        )),
        AgentType::Execute => McpServer::Composable(ComposableServer::new(
            "cadence-execute",
            vec![
                th::read_plan(&ctx),
                th::list_phases(&ctx),
                th::read_phase(&ctx),
                th::mark_agent_done(&ctx),
                th::mark_phase_done(&ctx),
            ],
        )),
        AgentType::Review => McpServer::Composable(ComposableServer::new(
            "cadence-review",
            vec![
                th::read_plan(&ctx),
                th::list_phases(&ctx),
                th::read_phase(&ctx),
                th::create_phase(&ctx),
                th::update_phase(&ctx),
                th::remove_phase(&ctx),
                th::mark_agent_done(&ctx),
                th::finalize_phases(&ctx),
            ],
        )),
        AgentType::Risk => McpServer::Composable(ComposableServer::new(
            "cadence-risk",
            vec![
                th::read_plan(&ctx),
                th::list_phases(&ctx),
                th::read_phase(&ctx),
                th::create_phase(&ctx),
                th::update_phase(&ctx),
                th::remove_phase(&ctx),
                th::mark_agent_done(&ctx),
                th::finalize_phases(&ctx),
            ],
        )),
        AgentType::Qa => McpServer::Composable(ComposableServer::new(
            "cadence-qa",
            vec![
                th::read_plan(&ctx),
                th::list_phases(&ctx),
                th::read_phase(&ctx),
                th::create_phase(&ctx),
                th::update_phase(&ctx),
                th::remove_phase(&ctx),
                th::mark_phase_done(&ctx),
                th::mark_agent_done(&ctx),
                th::finalize_phases(&ctx),
            ],
        )),
        AgentType::Retro => McpServer::Composable(ComposableServer::new(
            "cadence-retro",
            vec![
                th::read_plan(&ctx),
                th::list_phases(&ctx),
                th::read_phase(&ctx),
                th::read_prd(&ctx),
                th::list_conversations(&ctx),
                th::read_conversation(&ctx),
                th::mark_agent_done(&ctx),
            ],
        )),
    }
}

/// Returns the MCP server name string for the given agent type.
pub fn mcp_server_name(agent_type: AgentType) -> String {
    format!("cadence-{}", agent_type.short_name())
}

// ── Helpers ─────────────────────────────────────────────────────────

fn server_info(name: &str) -> ServerInfo {
    let caps = ServerCapabilities::builder().enable_tools().build();
    ServerInfo::new(caps).with_server_info(Implementation::new(name, "1.0.0"))
}

const FEATURE_ID_DESCRIPTION: &str =
    "The feature this call operates on. Required on every Cadence MCP tool call — agents must pass the feature_id from their system prompt.";

/// Inject `feature_id` into a schema's `properties` and `required` arrays.
/// Every Cadence MCP tool needs it because the subprocess is feature-agnostic
/// (see `context.rs::CURRENT_FEATURE_ID`).
fn inject_feature_id(mut schema: serde_json::Value) -> serde_json::Value {
    let obj = schema
        .as_object_mut()
        .expect("schema must be an object");
    obj.entry("properties")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .expect("properties must be an object")
        .insert(
            "feature_id".to_string(),
            json!({ "type": "integer", "description": FEATURE_ID_DESCRIPTION }),
        );
    let required = obj
        .entry("required")
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .expect("required must be an array");
    if !required.iter().any(|v| v.as_str() == Some("feature_id")) {
        required.push(json!("feature_id"));
    }
    schema
}

fn make_tool(name: &'static str, description: &'static str, schema: serde_json::Value) -> Tool {
    let obj: serde_json::Map<String, serde_json::Value> =
        serde_json::from_value(inject_feature_id(schema))
            .expect("schema must be an object");
    Tool::new(name, description, obj)
}

fn plan_id_tool(name: &'static str, description: &'static str) -> Tool {
    make_tool(
        name,
        description,
        json!({
            "type": "object",
            "properties": {
                "plan_id": { "type": "integer", "description": "The plan ID (optional — auto-resolved from feature if omitted)" }
            }
        }),
    )
}

fn phase_id_tool(name: &'static str, description: &'static str) -> Tool {
    make_tool(
        name,
        description,
        json!({
            "type": "object",
            "properties": {
                "phase_id": { "type": "integer", "description": "The phase ID" }
            },
            "required": ["phase_id"]
        }),
    )
}

fn tool_read_plan() -> Tool {
    plan_id_tool("read_plan", "Read full plan details including summary, context, clarifications, and completion conditions")
}

fn tool_list_phases() -> Tool {
    plan_id_tool("list_phases", "List all phases for a plan")
}

fn tool_read_phase() -> Tool {
    phase_id_tool("read_phase", "Read full details of a single phase")
}

fn tool_create_phase() -> Tool {
    make_tool(
        "create_phase",
        "Create a new phase in a plan",
        json!({
            "type": "object",
            "properties": {
                "plan_id": { "type": "integer", "description": "The plan ID (optional — auto-resolved from feature if omitted)" },
                "step_number": { "type": "integer", "description": "Step number for ordering" },
                "title": { "type": "string", "description": "Phase title" },
                "prompt": { "type": "string", "description": "Detailed prompt/instructions for the phase" },
                "complexity": { "type": "integer", "description": "Complexity rating (1-5)" },
                "commit_message": { "type": "string", "description": "Suggested commit message" },
                "phase_type": { "type": "string", "description": "Phase type (e.g. code, test, docs)" },
                "depends_on": { "type": "array", "items": { "type": "string" }, "description": "Titles of phases this phase depends on" }
            },
            "required": ["step_number", "title", "prompt"]
        }),
    )
}

fn tool_update_phase() -> Tool {
    make_tool(
        "update_phase",
        "Update an existing phase",
        json!({
            "type": "object",
            "properties": {
                "phase_id": { "type": "integer", "description": "The phase ID" },
                "title": { "type": "string", "description": "New title" },
                "step_number": { "type": "integer", "description": "New step number" },
                "complexity": { "type": "integer", "description": "New complexity rating (1-5)" },
                "commit_message": { "type": "string", "description": "New commit message" },
                "prompt": { "type": "string", "description": "New prompt/instructions" },
                "phase_type": { "type": "string", "description": "New phase type" },
                "depends_on": { "type": "array", "items": { "type": "string" }, "description": "Array of phase titles this phase depends on" }
            },
            "required": ["phase_id"]
        }),
    )
}

fn tool_remove_phase() -> Tool {
    phase_id_tool("remove_phase", "Remove a phase from a plan")
}

fn tool_update_plan() -> Tool {
    make_tool(
        "update_plan",
        "Update plan metadata",
        json!({
            "type": "object",
            "properties": {
                "plan_id": { "type": "integer", "description": "The plan ID (optional — auto-resolved from feature if omitted)" },
                "title": { "type": "string", "description": "New plan title" },
                "summary": { "type": "string", "description": "New plan summary" },
                "context": { "type": "string", "description": "New plan context" },
                "clarifications": { "type": "string", "description": "New clarifications" },
                "completion_conditions": { "type": "string", "description": "New completion conditions" }
            }
        }),
    )
}

fn tool_show_plan() -> Tool {
    plan_id_tool(
        "show_plan",
        "Show the plan to the user for approval (blocks until approved or rejected)",
    )
}

fn tool_finalize_plan() -> Tool {
    plan_id_tool(
        "finalize_plan",
        "Finalize a plan, marking it as ready for execution",
    )
}

fn tool_finalize_phases() -> Tool {
    plan_id_tool("finalize_phases", "Finalize all phases in a plan")
}

fn tool_mark_agent_done() -> Tool {
    make_tool(
        "mark_agent_done",
        "Signal that the agent has completed its work",
        json!({
            "type": "object",
            "properties": {
                "summary": { "type": "string", "description": "Optional summary of work done" }
            }
        }),
    )
}

fn tool_mark_phase_done() -> Tool {
    make_tool(
        "mark_phase_done",
        "Mark a phase as complete with optional notes",
        json!({
            "type": "object",
            "properties": {
                "phase_id": { "type": "integer", "description": "The phase ID" },
                "implementation_notes": { "type": "string", "description": "Notes about the implementation" },
                "deviations": { "type": "string", "description": "Any deviations from the plan" }
            },
            "required": ["phase_id"]
        }),
    )
}

fn tool_create_prd() -> Tool {
    make_tool(
        "create_prd",
        "Create or replace the PRD for the current feature",
        json!({
            "type": "object",
            "properties": {
                "prd": { "type": "string", "description": "The PRD content (markdown)" }
            },
            "required": ["prd"]
        }),
    )
}

fn tool_edit_prd() -> Tool {
    make_tool(
        "edit_prd",
        "Edit the PRD by replacing a substring",
        json!({
            "type": "object",
            "properties": {
                "old_string": { "type": "string", "description": "The text to find" },
                "new_string": { "type": "string", "description": "The replacement text" }
            },
            "required": ["old_string", "new_string"]
        }),
    )
}

fn tool_show_prd() -> Tool {
    make_tool(
        "show_prd",
        "Show the PRD to the user for approval (blocks until approved or rejected)",
        json!({ "type": "object", "properties": {} }),
    )
}

fn tool_read_prd() -> Tool {
    make_tool(
        "read_prd",
        "Read the current PRD for the feature",
        json!({ "type": "object", "properties": {} }),
    )
}

fn tool_list_conversations() -> Tool {
    make_tool(
        "list_conversations",
        "List all agent sessions/conversations for the feature",
        json!({ "type": "object", "properties": {} }),
    )
}

fn tool_read_conversation() -> Tool {
    make_tool(
        "read_conversation",
        "Read messages from an agent session",
        json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "integer", "description": "The session ID" },
                "offset": { "type": "integer", "description": "Offset for pagination" },
                "limit": { "type": "integer", "description": "Max messages to return" }
            },
            "required": ["session_id"]
        }),
    )
}
