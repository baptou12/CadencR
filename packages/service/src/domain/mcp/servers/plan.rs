use std::future::Future;
use std::sync::Arc;

use rmcp::{
    handler::server::ServerHandler,
    model::{
        CallToolRequestParams, CallToolResult, ErrorData, ListToolsResult, PaginatedRequestParams,
        ServerInfo,
    },
    service::{RequestContext, RoleServer},
};

use crate::domain::mcp::context::McpContext;
use crate::domain::mcp::tools::{
    create_phase::CreatePhaseTool,
    finalize_plan::FinalizePlanTool,
    helpers::{error_result, get_or_resolve_plan_id, require_i64, require_str, text_result},
    list_phases::ListPhasesTool,
    mark_agent_done::MarkAgentDoneTool,
    read_phase::ReadPhaseTool,
    read_plan::ReadPlanTool,
    remove_phase::RemovePhaseTool,
    show_plan::ShowPlanTool,
    update_phase::UpdatePhaseTool,
    update_plan::UpdatePlanTool,
};

use super::{
    server_info, tool_create_phase, tool_finalize_plan, tool_list_phases, tool_mark_agent_done,
    tool_read_phase, tool_read_plan, tool_remove_phase, tool_show_plan, tool_update_phase,
    tool_update_plan,
};

pub struct PlanServer {
    ctx: Arc<McpContext>,
    read_plan: ReadPlanTool,
    list_phases: ListPhasesTool,
    read_phase: ReadPhaseTool,
    create_phase: CreatePhaseTool,
    update_phase: UpdatePhaseTool,
    remove_phase: RemovePhaseTool,
    update_plan: UpdatePlanTool,
    show_plan: ShowPlanTool,
    finalize_plan: FinalizePlanTool,
    mark_agent_done: MarkAgentDoneTool,
}

impl PlanServer {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self {
            read_plan: ReadPlanTool::new(ctx.clone()),
            list_phases: ListPhasesTool::new(ctx.clone()),
            read_phase: ReadPhaseTool::new(ctx.clone()),
            create_phase: CreatePhaseTool::new(ctx.clone()),
            update_phase: UpdatePhaseTool::new(ctx.clone()),
            remove_phase: RemovePhaseTool::new(ctx.clone()),
            update_plan: UpdatePlanTool::new(ctx.clone()),
            show_plan: ShowPlanTool::new(ctx.clone()),
            finalize_plan: FinalizePlanTool::new(ctx.clone()),
            mark_agent_done: MarkAgentDoneTool::new(ctx.clone()),
            ctx,
        }
    }
}

impl ServerHandler for PlanServer {
    fn get_info(&self) -> ServerInfo {
        server_info("cadence-plan")
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ListToolsResult, ErrorData>> + Send + '_ {
        std::future::ready(Ok(ListToolsResult {
            meta: None,
            tools: vec![
                tool_read_plan(),
                tool_list_phases(),
                tool_read_phase(),
                tool_create_phase(),
                tool_update_phase(),
                tool_remove_phase(),
                tool_update_plan(),
                tool_show_plan(),
                tool_finalize_plan(),
                tool_mark_agent_done(),
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

            // Helper: resolve plan_id from args or feature context
            // Uses write_pool since get_or_resolve_plan_id may need to create a plan
            let feature_id = self.ctx.feature_id;
            let pool = &self.ctx.write_pool;

            let result = match request.name.as_ref() {
                "read_plan" => match get_or_resolve_plan_id(&args, pool, feature_id).await {
                    Ok(v) => self.read_plan.call(v).await,
                    Err(e) => Err(e),
                },
                "list_phases" => match get_or_resolve_plan_id(&args, pool, feature_id).await {
                    Ok(v) => self.list_phases.call(v).await,
                    Err(e) => Err(e),
                },
                "read_phase" => match require_i64(&args, "phase_id") {
                    Ok(v) => self.read_phase.call(v).await,
                    Err(e) => Err(e),
                },
                "create_phase" => {
                    match (
                        get_or_resolve_plan_id(&args, pool, feature_id).await,
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
                                        arr.iter()
                                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                            .collect()
                                    }),
                                )
                                .await
                        }
                        (Err(e), _, _, _)
                        | (_, Err(e), _, _)
                        | (_, _, Err(e), _)
                        | (_, _, _, Err(e)) => Err(e),
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
                                args["depends_on"].as_array().map(|arr| {
                                    arr.iter()
                                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                        .collect()
                                }),
                            )
                            .await
                    }
                    Err(e) => Err(e),
                },
                "remove_phase" => match require_i64(&args, "phase_id") {
                    Ok(v) => self.remove_phase.call(v).await,
                    Err(e) => Err(e),
                },
                "update_plan" => match get_or_resolve_plan_id(&args, pool, feature_id).await {
                    Ok(plan_id) => {
                        self.update_plan
                            .call(
                                plan_id,
                                args["title"].as_str().map(|s| s.to_string()),
                                args["summary"].as_str().map(|s| s.to_string()),
                                args["context"].as_str().map(|s| s.to_string()),
                                args["clarifications"].as_str().map(|s| s.to_string()),
                                args["completion_conditions"]
                                    .as_str()
                                    .map(|s| s.to_string()),
                            )
                            .await
                    }
                    Err(e) => Err(e),
                },
                "show_plan" => match get_or_resolve_plan_id(&args, pool, feature_id).await {
                    Ok(v) => self.show_plan.call(v).await,
                    Err(e) => Err(e),
                },
                "finalize_plan" => match get_or_resolve_plan_id(&args, pool, feature_id).await {
                    Ok(v) => self.finalize_plan.call(v).await,
                    Err(e) => Err(e),
                },
                "mark_agent_done" => {
                    self.mark_agent_done
                        .call(args["summary"].as_str().map(|s| s.to_string()))
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
