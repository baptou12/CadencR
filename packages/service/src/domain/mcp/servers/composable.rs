use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use rmcp::{
    handler::server::ServerHandler,
    model::{
        CallToolRequestParams, CallToolResult, ErrorData, ListToolsResult,
        PaginatedRequestParams, ServerInfo, Tool,
    },
    service::{RequestContext, RoleServer},
};
use serde_json::Value;

use crate::domain::mcp::tools::helpers::{error_result, text_result};

use super::server_info;

/// A function that handles a tool call given JSON args.
pub type ToolHandlerFn =
    Arc<dyn Fn(Value) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send>> + Send + Sync>;

/// A registered tool: its MCP definition paired with its async handler.
pub struct ToolRegistration {
    pub tool: Tool,
    pub handler: ToolHandlerFn,
}

/// A composable MCP server built from a name and a list of tool registrations.
/// Implements `ServerHandler` generically -- `list_tools` returns the registered
/// tools and `call_tool` dispatches by name.
pub struct ComposableServer {
    name: &'static str,
    tools: Vec<ToolRegistration>,
}

impl ComposableServer {
    pub fn new(name: &'static str, tools: Vec<ToolRegistration>) -> Self {
        Self { name, tools }
    }
}

impl ServerHandler for ComposableServer {
    fn get_info(&self) -> ServerInfo {
        server_info(self.name)
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
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<CallToolResult, ErrorData>> + Send + '_ {
        async move {
            let args = request
                .arguments
                .as_ref()
                .map(|m| Value::Object(m.clone()))
                .unwrap_or(Value::Null);

            let name = request.name.as_ref();
            let handler = self
                .tools
                .iter()
                .find(|t| t.tool.name.as_ref() == name)
                .map(|t| &t.handler);

            let result = match handler {
                Some(h) => (h)(args).await,
                None => Err(format!("Unknown tool: {name}")),
            };

            Ok(match result {
                Ok(text) => text_result(&text),
                Err(e) => error_result(&e),
            })
        }
    }
}
