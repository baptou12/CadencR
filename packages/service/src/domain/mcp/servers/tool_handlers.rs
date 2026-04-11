use std::sync::Arc;

use crate::domain::mcp::context::McpContext;
use crate::domain::mcp::tools::{
    create_phase::CreatePhaseTool,
    create_prd::CreatePrdTool,
    edit_prd::EditPrdTool,
    finalize_phases::FinalizePhases,
    helpers::{require_i64, require_str},
    list_conversations::ListConversationsTool,
    list_phases::ListPhasesTool,
    mark_agent_done::MarkAgentDoneTool,
    mark_phase_done::MarkPhaseDoneTool,
    read_conversation::ReadConversationTool,
    read_phase::ReadPhaseTool,
    read_plan::ReadPlanTool,
    read_prd::ReadPrdTool,
    remove_phase::RemovePhaseTool,
    show_prd::ShowPrdTool,
    update_phase::UpdatePhaseTool,
};

use super::composable::{ToolHandlerFn, ToolRegistration};
use super::{
    tool_create_phase, tool_create_prd, tool_edit_prd, tool_finalize_phases,
    tool_list_conversations, tool_list_phases, tool_mark_agent_done, tool_mark_phase_done,
    tool_read_conversation, tool_read_phase, tool_read_plan, tool_read_prd, tool_remove_phase,
    tool_show_prd, tool_update_phase,
};

fn handler(
    f: impl Fn(
            serde_json::Value,
        )
            -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<String, String>> + Send>>
        + Send
        + Sync
        + 'static,
) -> ToolHandlerFn {
    Arc::new(f)
}

pub fn read_plan(ctx: &Arc<McpContext>) -> ToolRegistration {
    let tool_impl = ReadPlanTool::new(ctx.clone());
    ToolRegistration {
        tool: tool_read_plan(),
        handler: handler(move |args| {
            let t = &tool_impl;
            let t = ReadPlanTool { ctx: t.ctx.clone() };
            Box::pin(async move {
                let plan_id = require_i64(&args, "plan_id")?;
                t.call(plan_id).await
            })
        }),
    }
}

pub fn list_phases(ctx: &Arc<McpContext>) -> ToolRegistration {
    let ctx = ctx.clone();
    ToolRegistration {
        tool: tool_list_phases(),
        handler: handler(move |args| {
            let t = ListPhasesTool::new(ctx.clone());
            Box::pin(async move {
                let plan_id = require_i64(&args, "plan_id")?;
                t.call(plan_id).await
            })
        }),
    }
}

pub fn read_phase(ctx: &Arc<McpContext>) -> ToolRegistration {
    let ctx = ctx.clone();
    ToolRegistration {
        tool: tool_read_phase(),
        handler: handler(move |args| {
            let t = ReadPhaseTool::new(ctx.clone());
            Box::pin(async move {
                let phase_id = require_i64(&args, "phase_id")?;
                t.call(phase_id).await
            })
        }),
    }
}

pub fn create_phase(ctx: &Arc<McpContext>) -> ToolRegistration {
    let ctx = ctx.clone();
    ToolRegistration {
        tool: tool_create_phase(),
        handler: handler(move |args| {
            let t = CreatePhaseTool::new(ctx.clone());
            Box::pin(async move {
                let plan_id = require_i64(&args, "plan_id")?;
                let step_number = require_i64(&args, "step_number")?;
                let title = require_str(&args, "title")?.to_string();
                let prompt = require_str(&args, "prompt")?.to_string();
                t.call(
                    plan_id,
                    step_number,
                    title,
                    prompt,
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
            })
        }),
    }
}

pub fn update_phase(ctx: &Arc<McpContext>) -> ToolRegistration {
    let ctx = ctx.clone();
    ToolRegistration {
        tool: tool_update_phase(),
        handler: handler(move |args| {
            let t = UpdatePhaseTool::new(ctx.clone());
            Box::pin(async move {
                let phase_id = require_i64(&args, "phase_id")?;
                t.call(
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
            })
        }),
    }
}

pub fn remove_phase(ctx: &Arc<McpContext>) -> ToolRegistration {
    let ctx = ctx.clone();
    ToolRegistration {
        tool: tool_remove_phase(),
        handler: handler(move |args| {
            let t = RemovePhaseTool::new(ctx.clone());
            Box::pin(async move {
                let phase_id = require_i64(&args, "phase_id")?;
                t.call(phase_id).await
            })
        }),
    }
}

pub fn mark_agent_done(ctx: &Arc<McpContext>) -> ToolRegistration {
    let ctx = ctx.clone();
    ToolRegistration {
        tool: tool_mark_agent_done(),
        handler: handler(move |args| {
            let t = MarkAgentDoneTool::new(ctx.clone());
            Box::pin(async move {
                t.call(args["summary"].as_str().map(|s| s.to_string()))
                    .await
            })
        }),
    }
}

pub fn finalize_phases(ctx: &Arc<McpContext>) -> ToolRegistration {
    let ctx = ctx.clone();
    ToolRegistration {
        tool: tool_finalize_phases(),
        handler: handler(move |args| {
            let t = FinalizePhases::new(ctx.clone());
            Box::pin(async move {
                let plan_id = require_i64(&args, "plan_id")?;
                t.call(plan_id).await
            })
        }),
    }
}

pub fn mark_phase_done(ctx: &Arc<McpContext>) -> ToolRegistration {
    let ctx = ctx.clone();
    ToolRegistration {
        tool: tool_mark_phase_done(),
        handler: handler(move |args| {
            let t = MarkPhaseDoneTool::new(ctx.clone());
            Box::pin(async move {
                let phase_id = require_i64(&args, "phase_id")?;
                t.call(
                    phase_id,
                    args["implementation_notes"].as_str().map(|s| s.to_string()),
                    args["deviations"].as_str().map(|s| s.to_string()),
                )
                .await
            })
        }),
    }
}

pub fn read_prd(ctx: &Arc<McpContext>) -> ToolRegistration {
    let ctx = ctx.clone();
    ToolRegistration {
        tool: tool_read_prd(),
        handler: handler(move |_args| {
            let t = ReadPrdTool::new(ctx.clone());
            Box::pin(async move { t.call().await })
        }),
    }
}

pub fn list_conversations(ctx: &Arc<McpContext>) -> ToolRegistration {
    let ctx = ctx.clone();
    ToolRegistration {
        tool: tool_list_conversations(),
        handler: handler(move |_args| {
            let t = ListConversationsTool::new(ctx.clone());
            Box::pin(async move { t.call().await })
        }),
    }
}

pub fn read_conversation(ctx: &Arc<McpContext>) -> ToolRegistration {
    let ctx = ctx.clone();
    ToolRegistration {
        tool: tool_read_conversation(),
        handler: handler(move |args| {
            let t = ReadConversationTool::new(ctx.clone());
            Box::pin(async move {
                let session_id = require_i64(&args, "session_id")?;
                t.call(session_id, args["offset"].as_i64(), args["limit"].as_i64())
                    .await
            })
        }),
    }
}

pub fn create_prd(ctx: &Arc<McpContext>) -> ToolRegistration {
    let ctx = ctx.clone();
    ToolRegistration {
        tool: tool_create_prd(),
        handler: handler(move |args| {
            let t = CreatePrdTool::new(ctx.clone());
            Box::pin(async move {
                let prd = require_str(&args, "prd")?.to_string();
                t.call(&prd).await
            })
        }),
    }
}

pub fn edit_prd(ctx: &Arc<McpContext>) -> ToolRegistration {
    let ctx = ctx.clone();
    ToolRegistration {
        tool: tool_edit_prd(),
        handler: handler(move |args| {
            let t = EditPrdTool::new(ctx.clone());
            Box::pin(async move {
                let old = require_str(&args, "old_string")?.to_string();
                let new = require_str(&args, "new_string")?.to_string();
                t.call(&old, &new).await
            })
        }),
    }
}

pub fn show_prd(ctx: &Arc<McpContext>) -> ToolRegistration {
    let ctx = ctx.clone();
    ToolRegistration {
        tool: tool_show_prd(),
        handler: handler(move |_args| {
            let t = ShowPrdTool::new(ctx.clone());
            Box::pin(async move { t.call().await })
        }),
    }
}
