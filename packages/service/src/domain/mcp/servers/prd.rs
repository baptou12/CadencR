use std::future::Future;
use std::sync::Arc;

use rmcp::{
    handler::server::ServerHandler,
    model::{
        CallToolRequestParams, CallToolResult, ErrorData, ListToolsResult,
        PaginatedRequestParams, ServerInfo,
    },
    service::{RequestContext, RoleServer},
};

use crate::domain::mcp::context::McpContext;
use crate::domain::mcp::tools::{
    create_prd::CreatePrdTool, edit_prd::EditPrdTool, helpers::{error_result, text_result},
    mark_agent_done::MarkAgentDoneTool, show_prd::ShowPrdTool,
};

use super::{server_info, tool_create_prd, tool_edit_prd, tool_mark_agent_done, tool_show_prd};

pub struct PrdServer {
    #[allow(dead_code)]
    ctx: Arc<McpContext>,
    create_prd: CreatePrdTool,
    edit_prd: EditPrdTool,
    show_prd: ShowPrdTool,
    mark_agent_done: MarkAgentDoneTool,
}

impl PrdServer {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self {
            create_prd: CreatePrdTool::new(ctx.clone()),
            edit_prd: EditPrdTool::new(ctx.clone()),
            show_prd: ShowPrdTool::new(ctx.clone()),
            mark_agent_done: MarkAgentDoneTool::new(ctx.clone()),
            ctx,
        }
    }
}

impl ServerHandler for PrdServer {
    fn get_info(&self) -> ServerInfo {
        server_info("cadence-prd")
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ListToolsResult, ErrorData>> + Send + '_ {
        std::future::ready(Ok(ListToolsResult { meta: None,
            tools: vec![tool_create_prd(), tool_edit_prd(), tool_show_prd(), tool_mark_agent_done()],
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

            let result = match request.name.as_ref() {
                "create_prd" => self.create_prd.call(args["prd"].as_str().unwrap_or("")).await,
                "edit_prd" => {
                    self.edit_prd
                        .call(
                            args["old_string"].as_str().unwrap_or(""),
                            args["new_string"].as_str().unwrap_or(""),
                        )
                        .await
                }
                "show_prd" => self.show_prd.call().await,
                "mark_agent_done" => {
                    self.mark_agent_done.call(args["summary"].as_str().map(|s| s.to_string())).await
                }
                other => Err(format!("Unknown tool: {other}")),
            };

            Ok(match result {
                Ok(text) => text_result(&text),
                Err(e) => error_result(&e),
            })
        }
    }
}
