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
use serde_json::json;

use crate::domain::mcp::context::McpContext;
use crate::domain::mcp::tools::helpers::{error_result, require_str, text_result};
use crate::domain::ws_workflow::repository as ws_repo;

use super::{make_tool, server_info};

pub struct WorkflowServer {
    ctx: Arc<McpContext>,
}

impl WorkflowServer {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    async fn create_artifact(&self, content: &str) -> Result<String, String> {
        let phase_slug = self.require_phase_slug()?;
        ws_repo::upsert_artifact(
            &self.ctx.write_pool,
            self.ctx.feature_id,
            &phase_slug,
            content,
            None,
        )
        .await
        .map_err(|e| e.to_string())?;
        let preview = &content[..content.len().min(200)];
        Ok(format!("Artifact created for phase '{phase_slug}'.\n\nPreview:\n{preview}"))
    }

    async fn read_artifact(&self, phase_slug: &str) -> Result<String, String> {
        let artifact = ws_repo::get_artifact(
            &self.ctx.read_pool,
            self.ctx.feature_id,
            phase_slug,
        )
        .await
        .map_err(|e| e.to_string())?;
        match artifact {
            Some(a) => Ok(a.content),
            None => Ok(format!("No artifact found for phase '{phase_slug}'")),
        }
    }

    async fn read_prior_artifacts(&self) -> Result<String, String> {
        let slugs = self.ctx.input_phase_slugs.as_ref().ok_or_else(|| {
            "No input phase slugs configured for this workflow agent".to_string()
        })?;
        if slugs.is_empty() {
            return Ok("No input phases configured.".to_string());
        }
        let mut parts = Vec::new();
        for slug in slugs {
            let artifact = ws_repo::get_artifact(
                &self.ctx.read_pool,
                self.ctx.feature_id,
                slug,
            )
            .await
            .map_err(|e| e.to_string())?;
            match artifact {
                Some(a) => parts.push(format!("## Phase: {slug}\n\n{}", a.content)),
                None => parts.push(format!("## Phase: {slug}\n\n(no artifact)")),
            }
        }
        Ok(parts.join("\n\n---\n\n"))
    }

    async fn read_project_context(&self) -> Result<String, String> {
        let row: Option<(String, i64, Option<String>)> = sqlx::query_as(
            "SELECT title, project_id, prd FROM features WHERE id = ?",
        )
        .bind(self.ctx.feature_id)
        .fetch_optional(&self.ctx.read_pool)
        .await
        .map_err(|e| e.to_string())?;

        let (feature_title, project_id, feature_description) =
            row.ok_or_else(|| format!("Feature {} not found", self.ctx.feature_id))?;

        let project: Option<(String, String)> =
            sqlx::query_as("SELECT name, path FROM projects WHERE id = ?")
                .bind(project_id)
                .fetch_optional(&self.ctx.read_pool)
                .await
                .map_err(|e| e.to_string())?;

        let (project_name, project_path) = project
            .ok_or_else(|| format!("Project {project_id} not found"))?;

        Ok(format!(
            "Project: {project_name}\nPath: {project_path}\nFeature: {feature_title}\nDescription: {}",
            feature_description.unwrap_or_else(|| "(none)".to_string())
        ))
    }

    async fn send_done(&self, summary: Option<String>) -> Result<String, String> {
        let mut guard = self.ctx.done_sender.lock().await;
        if let Some(sender) = guard.take() {
            let _ = sender.send(summary.clone());
            Ok(summary.unwrap_or_else(|| "Done.".to_string()))
        } else {
            Err("Done signal already sent".to_string())
        }
    }

    fn require_phase_slug(&self) -> Result<String, String> {
        self.ctx
            .phase_slug
            .clone()
            .ok_or_else(|| "No phase_slug configured for this workflow agent".to_string())
    }
}

impl ServerHandler for WorkflowServer {
    fn get_info(&self) -> ServerInfo {
        server_info("cadence-workflow")
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ListToolsResult, ErrorData>> + Send + '_ {
        std::future::ready(Ok(ListToolsResult {
            meta: None,
            tools: vec![
                tool_create_artifact(),
                tool_read_artifact(),
                tool_read_prior_artifacts(),
                tool_update_artifact(),
                tool_request_approval(),
                tool_mark_phase_complete(),
                tool_read_project_context(),
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
                "create_artifact" => match require_str(&args, "content") {
                    Ok(v) => self.create_artifact(v).await,
                    Err(e) => Err(e),
                },
                "read_artifact" => match require_str(&args, "phase_slug") {
                    Ok(v) => self.read_artifact(v).await,
                    Err(e) => Err(e),
                },
                "read_prior_artifacts" => self.read_prior_artifacts().await,
                "update_artifact" => match require_str(&args, "content") {
                    Ok(v) => self.create_artifact(v).await,
                    Err(e) => Err(e),
                },
                "request_approval" => {
                    let summary = args["summary"].as_str().map(|s| s.to_string());
                    self.send_done(summary).await
                }
                "mark_phase_complete" => self.send_done(None).await,
                "read_project_context" => self.read_project_context().await,
                other => Err(format!("Unknown tool: {other}")),
            };

            Ok(match result {
                Ok(text) => text_result(&text),
                Err(e) => error_result(&e),
            })
        }
    }
}

// ── Tool definitions ───────────────────────────────────────────────

fn tool_create_artifact() -> rmcp::model::Tool {
    make_tool(
        "create_artifact",
        "Create or overwrite the artifact for the current phase",
        json!({
            "type": "object",
            "properties": {
                "content": { "type": "string", "description": "The artifact content" }
            },
            "required": ["content"]
        }),
    )
}

fn tool_read_artifact() -> rmcp::model::Tool {
    make_tool(
        "read_artifact",
        "Read a specific phase's artifact",
        json!({
            "type": "object",
            "properties": {
                "phase_slug": { "type": "string", "description": "The phase slug to read artifact from" }
            },
            "required": ["phase_slug"]
        }),
    )
}

fn tool_read_prior_artifacts() -> rmcp::model::Tool {
    make_tool(
        "read_prior_artifacts",
        "Read all artifacts from input phases",
        json!({ "type": "object", "properties": {} }),
    )
}

fn tool_update_artifact() -> rmcp::model::Tool {
    make_tool(
        "update_artifact",
        "Update the current phase's artifact in place",
        json!({
            "type": "object",
            "properties": {
                "content": { "type": "string", "description": "The updated artifact content" }
            },
            "required": ["content"]
        }),
    )
}

fn tool_request_approval() -> rmcp::model::Tool {
    make_tool(
        "request_approval",
        "Signal phase completion and trigger approval gate",
        json!({
            "type": "object",
            "properties": {
                "summary": { "type": "string", "description": "Optional summary of what was produced" }
            }
        }),
    )
}

fn tool_mark_phase_complete() -> rmcp::model::Tool {
    make_tool(
        "mark_phase_complete",
        "Mark phase as done (for auto-gate phases)",
        json!({ "type": "object", "properties": {} }),
    )
}

fn tool_read_project_context() -> rmcp::model::Tool {
    make_tool(
        "read_project_context",
        "Read project-level context (project name, path, feature title, description)",
        json!({ "type": "object", "properties": {} }),
    )
}
