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
use crate::domain::ws_workflow::artifact_repository as ws_repo;
use crate::domain::ws_workflow::models::DEFAULT_ARTIFACT_TYPE;
use crate::domain::ws_workflow::task_repository;

use super::{make_tool, server_info};

pub struct WorkflowServer {
    ctx: Arc<McpContext>,
}

impl WorkflowServer {
    pub fn new(ctx: Arc<McpContext>) -> Self {
        Self { ctx }
    }

    async fn create_artifact(&self, content: &str, artifact_type: &str) -> Result<String, String> {
        let phase_slug = self.require_phase_slug()?;
        ws_repo::upsert_artifact(
            &self.ctx.write_pool,
            self.ctx.feature_id,
            &phase_slug,
            artifact_type,
            content,
            None,
        )
        .await
        .map_err(|e| e.to_string())?;
        let preview: String = content.chars().take(200).collect();
        let type_label = if artifact_type == DEFAULT_ARTIFACT_TYPE { String::new() } else { format!(" (type: {artifact_type})") };
        Ok(format!("Artifact created for phase '{phase_slug}'{type_label}.\n\nPreview:\n{preview}"))
    }

    async fn read_artifact(&self, phase_slug: &str, artifact_type: Option<&str>) -> Result<String, String> {
        match artifact_type {
            Some(at) => {
                let artifact = ws_repo::get_typed_artifact(
                    &self.ctx.read_pool, self.ctx.feature_id, phase_slug, at,
                ).await.map_err(|e| e.to_string())?;
                match artifact {
                    Some(a) => Ok(a.content),
                    None => Ok(format!("No artifact found for phase '{phase_slug}' type '{at}'")),
                }
            }
            None => {
                let artifacts = ws_repo::get_phase_artifacts(
                    &self.ctx.read_pool, self.ctx.feature_id, phase_slug,
                ).await.map_err(|e| e.to_string())?;
                match ws_repo::format_artifacts(&artifacts, None) {
                    Some(content) => Ok(content),
                    None => Ok(format!("No artifact found for phase '{phase_slug}'")),
                }
            }
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
            let artifacts = ws_repo::get_phase_artifacts(
                &self.ctx.read_pool,
                self.ctx.feature_id,
                slug,
            )
            .await
            .map_err(|e| e.to_string())?;
            match ws_repo::format_artifacts(&artifacts, Some(slug)) {
                None => parts.push(format!("## Phase: {slug}\n\n(no artifact)")),
                Some(content) => parts.push(content),
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

    async fn create_task(
        &self,
        title: &str,
        description: &str,
        commit_message: Option<&str>,
        depends_on: Vec<String>,
        parallel_group: Option<i32>,
    ) -> Result<String, String> {
        let phase_slug = self.require_phase_slug()?;
        let count = task_repository::count_tasks(
            &self.ctx.read_pool,
            self.ctx.feature_id,
            &phase_slug,
        )
        .await
        .map_err(|e| e.to_string())?;

        let order = count as i32;
        let group = parallel_group.unwrap_or(order);

        task_repository::insert_task(
            &self.ctx.write_pool,
            self.ctx.feature_id,
            &phase_slug,
            title,
            description,
            commit_message.unwrap_or(""),
            order,
            group,
            &depends_on,
        )
        .await
        .map_err(|e| e.to_string())?;

        Ok(format!(
            "Task #{} created: '{}' (group {})",
            order + 1,
            title,
            group
        ))
    }

    async fn finalize_tasks(&self) -> Result<String, String> {
        let phase_slug = self.require_phase_slug()?;

        let count = task_repository::count_tasks(
            &self.ctx.read_pool,
            self.ctx.feature_id,
            &phase_slug,
        )
        .await
        .map_err(|e| e.to_string())?;

        if count == 0 {
            return Err("No tasks to finalize. Use create_task first.".to_string());
        }

        task_repository::finalize_tasks(
            &self.ctx.write_pool,
            self.ctx.feature_id,
            &phase_slug,
        )
        .await
        .map_err(|e| e.to_string())?;

        // Signal phase completion — the gate handler will trigger expansion
        self.send_done(Some(format!("{count} tasks finalized"))).await
    }

    fn require_phase_slug(&self) -> Result<String, String> {
        self.ctx
            .phase_slug
            .clone()
            .ok_or_else(|| "No phase_slug configured for this workflow agent".to_string())
    }
}

#[allow(clippy::manual_async_fn)]
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
                tool_create_task(),
                tool_finalize_tasks(),
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
                    Ok(v) => {
                        let artifact_type = args["artifact_type"].as_str().unwrap_or(DEFAULT_ARTIFACT_TYPE);
                        self.create_artifact(v, artifact_type).await
                    }
                    Err(e) => Err(e),
                },
                "read_artifact" => match require_str(&args, "phase_slug") {
                    Ok(v) => {
                        let artifact_type = args["artifact_type"].as_str();
                        self.read_artifact(v, artifact_type).await
                    }
                    Err(e) => Err(e),
                },
                "read_prior_artifacts" => self.read_prior_artifacts().await,
                "update_artifact" => match require_str(&args, "content") {
                    Ok(v) => {
                        let artifact_type = args["artifact_type"].as_str().unwrap_or(DEFAULT_ARTIFACT_TYPE);
                        let phase_slug = match self.require_phase_slug() {
                            Ok(s) => s,
                            Err(e) => return Ok(error_result(&e)),
                        };
                        match ws_repo::get_typed_artifact(&self.ctx.read_pool, self.ctx.feature_id, &phase_slug, artifact_type).await {
                            Ok(Some(_)) => self.create_artifact(v, artifact_type).await,
                            Ok(None) => Err(format!("No artifact exists for phase '{phase_slug}' type '{artifact_type}'. Use create_artifact first.")),
                            Err(e) => Err(e.to_string()),
                        }
                    }
                    Err(e) => Err(e),
                },
                "request_approval" => {
                    let summary = args["summary"].as_str().map(|s| s.to_string());
                    self.send_done(summary).await
                }
                "mark_phase_complete" => self.send_done(None).await,
                "read_project_context" => self.read_project_context().await,
                "create_task" => {
                    match require_str(&args, "title") {
                        Ok(title) => {
                            let description = args["description"].as_str().unwrap_or("");
                            let commit_message = args["commit_message"].as_str();
                            let depends_on: Vec<String> = args["depends_on"]
                                .as_array()
                                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                                .unwrap_or_default();
                            let parallel_group = args["parallel_group"].as_i64().map(|v| v as i32);
                            self.create_task(title, description, commit_message, depends_on, parallel_group).await
                        }
                        Err(e) => Err(e),
                    }
                }
                "finalize_tasks" => self.finalize_tasks().await,
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
        "Create or overwrite an artifact for the current phase. Use artifact_type to create multiple named artifacts per phase.",
        json!({
            "type": "object",
            "properties": {
                "content": { "type": "string", "description": "The artifact content" },
                "artifact_type": { "type": "string", "description": "Artifact type identifier. Defaults to 'default' for single-artifact phases. Use distinct types (e.g. 'proposal', 'specs') for multi-artifact phases." }
            },
            "required": ["content"]
        }),
    )
}

fn tool_read_artifact() -> rmcp::model::Tool {
    make_tool(
        "read_artifact",
        "Read a specific phase's artifact. If artifact_type is omitted, returns all artifacts for the phase.",
        json!({
            "type": "object",
            "properties": {
                "phase_slug": { "type": "string", "description": "The phase slug to read artifact from" },
                "artifact_type": { "type": "string", "description": "Optional: specific artifact type to read" }
            },
            "required": ["phase_slug"]
        }),
    )
}

fn tool_read_prior_artifacts() -> rmcp::model::Tool {
    make_tool("read_prior_artifacts", "Read all artifacts from input phases", json!({ "type": "object", "properties": {} }))
}

fn tool_update_artifact() -> rmcp::model::Tool {
    make_tool(
        "update_artifact",
        "Update the current phase's artifact in place",
        json!({
            "type": "object",
            "properties": {
                "content": { "type": "string", "description": "The updated artifact content" },
                "artifact_type": { "type": "string", "description": "Artifact type to update. Defaults to 'default'." }
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
    make_tool("mark_phase_complete", "Mark phase as done (for auto-gate phases)", json!({ "type": "object", "properties": {} }))
}

fn tool_read_project_context() -> rmcp::model::Tool {
    make_tool("read_project_context", "Read project-level context", json!({ "type": "object", "properties": {} }))
}

fn tool_create_task() -> rmcp::model::Tool {
    make_tool(
        "create_task",
        "Register an implementation task. Call this for each task, then call finalize_tasks when done.",
        json!({
            "type": "object",
            "properties": {
                "title": { "type": "string", "description": "Short descriptive task name" },
                "description": { "type": "string", "description": "What needs to be implemented" },
                "commit_message": { "type": "string", "description": "Conventional commit message for this task" },
                "depends_on": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Titles of tasks this depends on"
                },
                "parallel_group": {
                    "type": "integer",
                    "description": "Group number — tasks in the same group can run in parallel"
                }
            },
            "required": ["title", "description"]
        }),
    )
}

fn tool_finalize_tasks() -> rmcp::model::Tool {
    make_tool("finalize_tasks", "Finalize all registered tasks. Expands them into individual execute agents.", json!({ "type": "object", "properties": {} }))
}
