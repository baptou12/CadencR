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
    browser::{open_url_allowed, BROWSER_TOOL_NAMES},
    browser_bridge::{BrowserBridgeClient, BrowserBridgeRequest},
    helpers::{dispatch_tool, error_result, pinned_feature_id},
};

use super::server_info;

pub struct BrowserServer {
    ctx: Arc<McpContext>,
}

impl BrowserServer {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }
}

fn make_tool(name: &'static str, description: &'static str, schema: serde_json::Value) -> Tool {
    let obj: serde_json::Map<String, serde_json::Value> =
        serde_json::from_value(schema).expect("schema must be an object");
    Tool::new(name, description, obj)
}

fn tools() -> Vec<Tool> {
    // Workspace/session tools are intentionally not exposed by
    // `cadencr-browser`. `list_conversations` and `read_conversation` will be
    // used later by a dedicated `cadencr-workspace` MCP server.
    BROWSER_TOOL_NAMES.into_iter().map(browser_tool).collect()
}

fn browser_tool(name: &'static str) -> Tool {
    make_tool(
        name,
        "Control or inspect the Cadencr Browser workspace tab. Mutating tools require the active tab to be localhost at execution time.",
        json!({
            "type": "object",
            "properties": {
                "tab_id": { "type": "string", "description": "Browser tab id" },
                "url": { "type": "string", "description": "URL for browser_open_url" },
                "x": { "type": "number", "description": "Click x coordinate" },
                "y": { "type": "number", "description": "Click y coordinate" },
                "text": { "type": "string", "description": "Text for browser_type" },
                "key": { "type": "string", "description": "Key for browser_keypress" }
            }
        }),
    )
}

impl ServerHandler for BrowserServer {
    fn get_info(&self) -> ServerInfo {
        server_info("cadencr-browser")
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
                    name if BROWSER_TOOL_NAMES.contains(&name) => {
                        if name == "browser_open_url" {
                            let target_url = args["url"]
                                .as_str()
                                .ok_or_else(|| "Missing required parameter: url".to_string())?;
                            open_url_allowed(target_url)?;
                        }
                        let client = BrowserBridgeClient::from_env().ok_or_else(|| {
                            "Browser MCP execution requires the desktop Browser bridge.".to_string()
                        })?;
                        client
                            .call(BrowserBridgeRequest::new(name, args.clone()))
                            .await
                    }
                    other => Err(format!("Unknown tool: {other}")),
                }
            })
            .await)
        }
    }
}
