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
    helpers::{error_result, text_result}, list_phases::ListPhasesTool,
    mark_agent_done::MarkAgentDoneTool, mark_phase_done::MarkPhaseDoneTool,
    read_phase::ReadPhaseTool, read_plan::ReadPlanTool, read_prd::ReadPrdTool,
};

use super::{
    server_info, tool_list_phases, tool_mark_agent_done, tool_mark_phase_done, tool_read_phase,
    tool_read_plan, tool_read_prd,
};

pub struct SessionServer {
    #[allow(dead_code)]
    ctx: Arc<McpContext>,
    read_plan: ReadPlanTool,
    list_phases: ListPhasesTool,
    read_phase: ReadPhaseTool,
    read_prd: ReadPrdTool,
    mark_agent_done: MarkAgentDoneTool,
    mark_phase_done: MarkPhaseDoneTool,
}

impl SessionServer {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self {
            read_plan: ReadPlanTool::new(ctx.clone()),
            list_phases: ListPhasesTool::new(ctx.clone()),
            read_phase: ReadPhaseTool::new(ctx.clone()),
            read_prd: ReadPrdTool::new(ctx.clone()),
            mark_agent_done: MarkAgentDoneTool::new(ctx.clone()),
            mark_phase_done: MarkPhaseDoneTool::new(ctx.clone()),
            ctx,
        }
    }
}

impl ServerHandler for SessionServer {
    fn get_info(&self) -> ServerInfo {
        server_info("cadence-session")
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ListToolsResult, ErrorData>> + Send + '_ {
        std::future::ready(Ok(ListToolsResult { meta: None,
            tools: vec![
                tool_read_plan(),
                tool_list_phases(),
                tool_read_phase(),
                tool_read_prd(),
                tool_mark_agent_done(),
                tool_mark_phase_done(),
            ],
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
                "read_plan" => self.read_plan.call(args["plan_id"].as_i64().unwrap_or(0)).await,
                "list_phases" => self.list_phases.call(args["plan_id"].as_i64().unwrap_or(0)).await,
                "read_phase" => self.read_phase.call(args["phase_id"].as_i64().unwrap_or(0)).await,
                "read_prd" => self.read_prd.call().await,
                "mark_agent_done" => {
                    self.mark_agent_done.call(args["summary"].as_str().map(|s| s.to_string())).await
                }
                "mark_phase_done" => {
                    self.mark_phase_done
                        .call(
                            args["phase_id"].as_i64().unwrap_or(0),
                            args["implementation_notes"].as_str().map(|s| s.to_string()),
                            args["deviations"].as_str().map(|s| s.to_string()),
                        )
                        .await
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
