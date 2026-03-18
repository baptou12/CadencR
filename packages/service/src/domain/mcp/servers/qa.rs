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
    create_phase::CreatePhaseTool, finalize_phases::FinalizePhases,
    helpers::{error_result, require_i64, require_str, text_result}, list_phases::ListPhasesTool,
    mark_agent_done::MarkAgentDoneTool, mark_phase_done::MarkPhaseDoneTool,
    read_phase::ReadPhaseTool, read_plan::ReadPlanTool, remove_phase::RemovePhaseTool,
    update_phase::UpdatePhaseTool,
};

use super::{
    server_info, tool_create_phase, tool_finalize_phases, tool_list_phases, tool_mark_agent_done,
    tool_mark_phase_done, tool_read_phase, tool_read_plan, tool_remove_phase, tool_update_phase,
};

pub struct QaServer {
    #[allow(dead_code)]
    ctx: Arc<McpContext>,
    read_plan: ReadPlanTool,
    list_phases: ListPhasesTool,
    read_phase: ReadPhaseTool,
    create_phase: CreatePhaseTool,
    update_phase: UpdatePhaseTool,
    remove_phase: RemovePhaseTool,
    mark_phase_done: MarkPhaseDoneTool,
    mark_agent_done: MarkAgentDoneTool,
    finalize_phases: FinalizePhases,
}

impl QaServer {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self {
            read_plan: ReadPlanTool::new(ctx.clone()),
            list_phases: ListPhasesTool::new(ctx.clone()),
            read_phase: ReadPhaseTool::new(ctx.clone()),
            create_phase: CreatePhaseTool::new(ctx.clone()),
            update_phase: UpdatePhaseTool::new(ctx.clone()),
            remove_phase: RemovePhaseTool::new(ctx.clone()),
            mark_phase_done: MarkPhaseDoneTool::new(ctx.clone()),
            mark_agent_done: MarkAgentDoneTool::new(ctx.clone()),
            finalize_phases: FinalizePhases::new(ctx.clone()),
            ctx,
        }
    }
}

impl ServerHandler for QaServer {
    fn get_info(&self) -> ServerInfo {
        server_info("cadence-qa")
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
                tool_create_phase(),
                tool_update_phase(),
                tool_remove_phase(),
                tool_mark_phase_done(),
                tool_mark_agent_done(),
                tool_finalize_phases(),
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
                "read_plan" => match require_i64(&args, "plan_id") {
                    Ok(v) => self.read_plan.call(v).await,
                    Err(e) => Err(e),
                },
                "list_phases" => match require_i64(&args, "plan_id") {
                    Ok(v) => self.list_phases.call(v).await,
                    Err(e) => Err(e),
                },
                "read_phase" => match require_i64(&args, "phase_id") {
                    Ok(v) => self.read_phase.call(v).await,
                    Err(e) => Err(e),
                },
                "create_phase" => {
                    match (
                        require_i64(&args, "plan_id"),
                        require_i64(&args, "step_number"),
                        require_str(&args, "title"),
                        require_str(&args, "prompt"),
                    ) {
                        (Ok(plan_id), Ok(step_number), Ok(title), Ok(prompt)) => {
                            self.create_phase
                                .call(
                                    plan_id,
                                    step_number,
                                    title.to_string(),
                                    prompt.to_string(),
                                    args["complexity"].as_i64().map(|v| v as i8),
                                    args["commit_message"].as_str().map(|s| s.to_string()),
                                    args["phase_type"].as_str().map(|s| s.to_string()),
                                    args["depends_on"].as_array().map(|arr| {
                                        arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()
                                    }),
                                )
                                .await
                        }
                        (Err(e), _, _, _) | (_, Err(e), _, _) | (_, _, Err(e), _) | (_, _, _, Err(e)) => Err(e),
                    }
                }
                "update_phase" => match require_i64(&args, "phase_id") {
                    Ok(phase_id) => {
                        self.update_phase
                            .call(
                                phase_id,
                                args["title"].as_str().map(|s| s.to_string()),
                                args["step_number"].as_i64(),
                                args["complexity"].as_i64().map(|v| v as i8),
                                args["commit_message"].as_str().map(|s| s.to_string()),
                                args["prompt"].as_str().map(|s| s.to_string()),
                                args["phase_type"].as_str().map(|s| s.to_string()),
                            )
                            .await
                    }
                    Err(e) => Err(e),
                },
                "remove_phase" => match require_i64(&args, "phase_id") {
                    Ok(v) => self.remove_phase.call(v).await,
                    Err(e) => Err(e),
                },
                "mark_phase_done" => match require_i64(&args, "phase_id") {
                    Ok(phase_id) => {
                        self.mark_phase_done
                            .call(
                                phase_id,
                                args["implementation_notes"].as_str().map(|s| s.to_string()),
                                args["deviations"].as_str().map(|s| s.to_string()),
                            )
                            .await
                    }
                    Err(e) => Err(e),
                },
                "mark_agent_done" => {
                    self.mark_agent_done.call(args["summary"].as_str().map(|s| s.to_string())).await
                }
                "finalize_phases" => match require_i64(&args, "plan_id") {
                    Ok(v) => self.finalize_phases.call(v).await,
                    Err(e) => Err(e),
                },
                other => Err(format!("Unknown tool: {other}")),
            };

            Ok(match result {
                Ok(text) => text_result(&text),
                Err(e) => error_result(&e),
            })
        }
    }
}
