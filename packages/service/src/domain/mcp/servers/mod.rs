pub mod execute;
pub mod plan;
pub mod prd;
pub mod qa;
pub mod retro;
pub mod review;
pub mod risk;
pub mod session;

use std::sync::Arc;

use rmcp::model::{Implementation, ServerCapabilities, ServerInfo, Tool};
use serde_json::json;

use super::context::McpContext;
use self::{
    execute::ExecuteServer, plan::PlanServer, prd::PrdServer, qa::QaServer,
    retro::RetroServer, review::ReviewServer, risk::RiskServer, session::SessionServer,
};

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

/// A type-erased MCP server wrapper that can hold any agent server type.
/// Needed because `ServerHandler` is not dyn-compatible (requires `Self: Sized`).
pub enum McpServer {
    Plan(PlanServer),
    Prd(PrdServer),
    Execute(ExecuteServer),
    Qa(QaServer),
    Review(ReviewServer),
    Risk(RiskServer),
    Retro(RetroServer),
    Session(SessionServer),
}

/// Create the appropriate MCP server for the given agent type.
pub fn create_mcp_server(agent_type: AgentType, ctx: Arc<McpContext>) -> McpServer {
    match agent_type {
        AgentType::Plan => McpServer::Plan(PlanServer::new(ctx)),
        AgentType::Prd => McpServer::Prd(PrdServer::new(ctx)),
        AgentType::Execute => McpServer::Execute(ExecuteServer::new(ctx)),
        AgentType::Qa => McpServer::Qa(QaServer::new(ctx)),
        AgentType::Review => McpServer::Review(ReviewServer::new(ctx)),
        AgentType::Risk => McpServer::Risk(RiskServer::new(ctx)),
        AgentType::Retro => McpServer::Retro(RetroServer::new(ctx)),
        AgentType::Session => McpServer::Session(SessionServer::new(ctx)),
    }
}

/// Returns the MCP server name string for the given agent type.
pub fn mcp_server_name(agent_type: AgentType) -> &'static str {
    match agent_type {
        AgentType::Plan => "cadence-plan",
        AgentType::Prd => "cadence-prd",
        AgentType::Execute => "cadence-execute",
        AgentType::Qa => "cadence-qa",
        AgentType::Review => "cadence-review",
        AgentType::Risk => "cadence-risk",
        AgentType::Retro => "cadence-retro",
        AgentType::Session => "cadence-session",
    }
}

// ── Helpers ─────────────────────────────────────────────────────────

fn server_info(name: &str) -> ServerInfo {
    let caps = ServerCapabilities::builder().enable_tools().build();
    ServerInfo::new(caps).with_server_info(Implementation::new(name, "1.0.0"))
}

fn make_tool(name: &'static str, description: &'static str, schema: serde_json::Value) -> Tool {
    let obj: serde_json::Map<String, serde_json::Value> =
        serde_json::from_value(schema).expect("schema must be an object");
    Tool::new(name, description, obj)
}

fn plan_id_tool(name: &'static str, description: &'static str) -> Tool {
    make_tool(
        name,
        description,
        json!({
            "type": "object",
            "properties": {
                "plan_id": { "type": "integer", "description": "The plan ID" }
            },
            "required": ["plan_id"]
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
                "plan_id": { "type": "integer", "description": "The plan ID" },
                "step_number": { "type": "integer", "description": "Step number for ordering" },
                "title": { "type": "string", "description": "Phase title" },
                "prompt": { "type": "string", "description": "Detailed prompt/instructions for the phase" },
                "complexity": { "type": "integer", "description": "Complexity rating (1-5)" },
                "commit_message": { "type": "string", "description": "Suggested commit message" },
                "phase_type": { "type": "string", "description": "Phase type (e.g. code, test, docs)" },
                "depends_on": { "type": "array", "items": { "type": "string" }, "description": "Titles of phases this phase depends on" }
            },
            "required": ["plan_id", "step_number", "title", "prompt"]
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
                "phase_type": { "type": "string", "description": "New phase type" }
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
                "plan_id": { "type": "integer", "description": "The plan ID" },
                "title": { "type": "string", "description": "New plan title" },
                "summary": { "type": "string", "description": "New plan summary" },
                "context": { "type": "string", "description": "New plan context" },
                "clarifications": { "type": "string", "description": "New clarifications" },
                "completion_conditions": { "type": "string", "description": "New completion conditions" }
            },
            "required": ["plan_id"]
        }),
    )
}

fn tool_show_plan() -> Tool {
    plan_id_tool("show_plan", "Show the plan to the user for approval (blocks until approved or rejected)")
}

fn tool_finalize_plan() -> Tool {
    plan_id_tool("finalize_plan", "Finalize a plan, marking it as ready for execution")
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
