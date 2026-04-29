use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use rmcp::{
    handler::server::ServerHandler,
    model::{
        CallToolRequestParams, CallToolResult, ErrorData, ListToolsResult, PaginatedRequestParams,
        ServerInfo, Tool,
    },
    service::{RequestContext, RoleServer},
};
use serde_json::Value;

use crate::domain::mcp::tools::helpers::{dispatch_tool, error_result, pinned_feature_id};

use super::server_info;

/// A function that handles a tool call given JSON args.
pub type ToolHandlerFn = Arc<
    dyn Fn(Value) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send>> + Send + Sync,
>;

/// A registered tool: its MCP definition paired with its async handler.
pub struct ToolRegistration {
    pub tool: Tool,
    pub handler: ToolHandlerFn,
}

/// A composable MCP server built from a name and a list of tool registrations.
/// Implements `ServerHandler` generically -- `list_tools` returns the registered
/// tools and `call_tool` dispatches by name.
pub struct ComposableServer {
    name: String,
    tools: Vec<ToolRegistration>,
    feature_id: i64,
}

impl ComposableServer {
    pub fn new(name: impl Into<String>, tools: Vec<ToolRegistration>, feature_id: i64) -> Self {
        Self {
            name: name.into(),
            tools,
            feature_id,
        }
    }
}

impl ServerHandler for ComposableServer {
    fn get_info(&self) -> ServerInfo {
        server_info(&self.name)
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ListToolsResult, ErrorData>> + Send + '_ {
        std::future::ready(Ok(ListToolsResult {
            meta: None,
            tools: self.tools.iter().map(|t| t.tool.clone()).collect(),
            next_cursor: None,
        }))
    }

    fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<CallToolResult, ErrorData>> + Send + '_ {
        async move {
            let args = request
                .arguments
                .as_ref()
                .map(|m| Value::Object(m.clone()))
                .unwrap_or(Value::Null);
            if let Err(e) = pinned_feature_id(&args, self.feature_id) {
                return Ok(error_result(&e));
            }
            let name = request.name.clone();
            if let Err(e) = super::approval_elicitation::maybe_elicit_tool_approval(
                &context,
                &self.name,
                name.as_ref(),
                &args,
            )
            .await
            {
                return Ok(error_result(&e));
            }
            let handler = self
                .tools
                .iter()
                .find(|t| t.tool.name.as_ref() == name.as_ref())
                .map(|t| t.handler.clone());

            Ok(dispatch_tool(async move {
                match handler {
                    Some(h) => (h)(args).await,
                    None => Err(format!("Unknown tool: {name}")),
                }
            })
            .await)
        }
    }
}
