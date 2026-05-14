use std::future::Future;
use std::sync::Arc;

use rmcp::{
    handler::server::ServerHandler,
    model::{
        CallToolRequestParams, CallToolResult, ErrorData, ListToolsResult, PaginatedRequestParams,
        ServerInfo, Tool,
    },
    service::{RequestContext, RoleServer},
};
use serde_json::json;

use crate::domain::mcp::context::McpContext;
use crate::domain::mcp::tools::{
    helpers::{dispatch_tool, error_result, pinned_feature_id, require_i64},
    list_conversations::ListConversationsTool,
    mark_agent_done::MarkAgentDoneTool,
    read_conversation::ReadConversationTool,
};

use super::server_info;

const FEATURE_ID_DESCRIPTION: &str =
    "The feature this call operates on. Required on every Cadencr MCP tool call — agents must pass the feature_id from their system prompt.";

pub struct SessionServer {
    ctx: Arc<McpContext>,
    mark_agent_done: MarkAgentDoneTool,
    list_conversations: ListConversationsTool,
    read_conversation: ReadConversationTool,
}

impl SessionServer {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self {
            mark_agent_done: MarkAgentDoneTool::new(ctx.clone()),
            list_conversations: ListConversationsTool::new(ctx.clone()),
            read_conversation: ReadConversationTool::new(ctx.clone()),
            ctx,
        }
    }
}

fn inject_feature_id(mut schema: serde_json::Value) -> serde_json::Value {
    let obj = schema.as_object_mut().expect("schema must be an object");
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
        serde_json::from_value(inject_feature_id(schema)).expect("schema must be an object");
    Tool::new(name, description, obj)
}

fn tools() -> Vec<Tool> {
    vec![
        make_tool(
            "mark_agent_done",
            "Signal that the agent has completed its work",
            json!({
                "type": "object",
                "properties": {
                    "summary": { "type": "string", "description": "Optional summary of work done" }
                }
            }),
        ),
        make_tool(
            "list_conversations",
            "List all agent sessions/conversations for the feature",
            json!({ "type": "object", "properties": {} }),
        ),
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
        ),
    ]
}

impl ServerHandler for SessionServer {
    fn get_info(&self) -> ServerInfo {
        server_info("cadencr-session")
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ListToolsResult, ErrorData>> + Send + '_ {
        std::future::ready(Ok(ListToolsResult {
            meta: None,
            tools: tools(),
            next_cursor: None,
        }))
    }

    fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<CallToolResult, ErrorData>> + Send + '_ {
        async move {
            let args = request
                .arguments
                .as_ref()
                .map(|m| serde_json::Value::Object(m.clone()))
                .unwrap_or(serde_json::Value::Null);
            if let Err(e) = pinned_feature_id(&args, self.ctx.feature_id) {
                return Ok(error_result(&e));
            }

            Ok(dispatch_tool(async move {
                match request.name.as_ref() {
                    "mark_agent_done" => {
                        self.mark_agent_done
                            .call(args["summary"].as_str().map(|s| s.to_string()))
                            .await
                    }
                    "list_conversations" => self.list_conversations.call().await,
                    "read_conversation" => {
                        let session_id = require_i64(&args, "session_id")?;
                        self.read_conversation
                            .call(session_id, args["offset"].as_i64(), args["limit"].as_i64())
                            .await
                    }
                    other => Err(format!("Unknown tool: {other}")),
                }
            })
            .await)
        }
    }
}
