//! SpawnContext construction and settings resolution for AgentManager.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::mpsc;
use tracing::info;

use claude_agent_sdk_rs::{Options, PermissionMode};

use crate::domain::mcp::servers::{AgentType, mcp_server_name};
use crate::domain::workflow::engine::AgentSlot;
use crate::domain::workflow::permission_router::{PermissionRouter, WorkflowPermissionBridge};
use crate::domain::ws_session::handler::mcp_spawn::build_mcp_server_config;
use crate::domain::ws_session::handler::session_prompt::PermissionResponse;
use crate::domain::ws_session::permissions;

use super::{AgentManager, SpawnContext};

impl AgentManager {
    /// Get the feature's working directory.
    /// Prefers worktree_path from feature_settings if set, otherwise falls back to project directory.
    pub async fn get_feature_cwd(&self) -> Option<PathBuf> {
        let wt_row: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
        )
        .bind(self.feature_id)
        .fetch_optional(&self.read_pool)
        .await
        .ok()?;
        if let Some(Some(wt_path)) = wt_row.map(|(v,)| v) {
            let p = PathBuf::from(&wt_path);
            if !wt_path.is_empty() && p.is_dir() {
                return Some(p);
            }
        }
        let row: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT p.path FROM projects p JOIN features f ON f.project_id = p.id WHERE f.id = ?",
        )
        .bind(self.feature_id)
        .fetch_optional(&self.read_pool)
        .await
        .ok()?;
        row.and_then(|(d,)| d).map(PathBuf::from)
    }

    /// Get the project_id for this feature.
    pub(super) async fn get_project_id(&self) -> Option<i64> {
        sqlx::query_scalar::<_, i64>("SELECT project_id FROM features WHERE id = ?")
            .bind(self.feature_id)
            .fetch_optional(&self.read_pool)
            .await
            .ok()
            .flatten()
    }

    /// Resolve a setting using the shared feature → project → global cascade.
    pub(super) async fn resolve_setting(&self, key: &str, project_id: Option<i64>, default: Option<&str>) -> Option<String> {
        crate::domain::settings::resolve_setting(
            &self.read_pool,
            key,
            Some(self.feature_id),
            project_id,
            default,
        )
        .await
    }

    /// Resolve the model for a given agent type.
    pub(super) async fn resolve_model(&self, agent_type_str: &str, project_id: Option<i64>) -> String {
        const DEFAULT_MODEL: &str = crate::api::DEFAULT_MODEL;
        let db_key = format!("model_{agent_type_str}");
        self.resolve_setting(&db_key, project_id, Some(DEFAULT_MODEL))
            .await
            .unwrap_or_else(|| DEFAULT_MODEL.to_string())
    }

    /// Build the language instruction to append to system prompts.
    pub(super) async fn build_language_instruction(&self, project_id: Option<i64>) -> Option<String> {
        self.resolve_setting("language", project_id, None)
            .await
            .map(|l| format!("\n\n## Language\n\nYou MUST respond in {l}."))
    }

    /// Build a SpawnContext with all the shared setup: MCP config, CWD, permission
    /// bridge, model resolution, language instruction, and Options construction.
    ///
    /// The caller is responsible for creating the DB session and slot beforehand,
    /// since those differ between spawn_pre_queue_agent, start_item, and resume_item.
    pub(super) async fn build_spawn_context(
        &self,
        slot: AgentSlot,
        db_session_id: i64,
        agent_type: AgentType,
        agent_type_str: &str,
        system_prompt: Option<&str>,
        resume_session_id: Option<&str>,
        include_mcp_instructions: bool,
        permissions: &PermissionRouter,
    ) -> Result<SpawnContext, String> {
        let mcp_servers = build_mcp_server_config(agent_type, self.feature_id);
        let expected_mcp_server = mcp_server_name(agent_type).to_string();

        let cwd = self.get_feature_cwd().await.ok_or_else(|| {
            format!("No working directory found for feature {}. Was ensure_worktree called?", self.feature_id)
        })?;

        // Permission bridge
        let (perm_tx, perm_rx) = mpsc::channel::<PermissionResponse>(16);
        permissions.register(slot.clone(), perm_tx);
        let allowed_patterns = Arc::new(permissions::load_allowed_patterns(&cwd));
        let bridge = WorkflowPermissionBridge {
            slot: slot.clone(),
            feature_id: self.feature_id,
            sender: self.ws_sender.clone(),
            response_rx: Arc::new(tokio::sync::Mutex::new(perm_rx)),
            worktree_path: cwd.clone(),
            session_cache: Arc::new(tokio::sync::Mutex::new(HashSet::new())),
            allowed_patterns,
            read_pool: self.read_pool.clone(),
            write_pool: self.write_pool.clone(),
            db_session_id,
            turn_state_tx: self.turn_state_tx.clone(),
        };

        // Model + language
        let project_id = self.get_project_id().await;
        let model = self.resolve_model(agent_type_str, project_id).await;
        let language_instruction = self.build_language_instruction(project_id).await;
        info!(feature_id = self.feature_id, agent_type = agent_type_str, model = %model, "resolved model");

        let _ = sqlx::query("UPDATE agent_sessions SET model = ? WHERE id = ?")
            .bind(&model)
            .bind(db_session_id)
            .execute(&self.write_pool)
            .await;

        // Build system prompt with optional MCP instructions and language
        let full_system_prompt = match system_prompt {
            Some(sp) if !sp.is_empty() => {
                let mcp_suffix = if include_mcp_instructions {
                    "\n\n## MCP Tools\n\n\
                     The MCP tools will auto-resolve plan_id from your feature — you do NOT need to pass plan_id to any tool. \
                     Just omit it and the correct plan will be used automatically."
                } else {
                    ""
                };
                Some(format!(
                    "{sp}{mcp_suffix}{}",
                    language_instruction.as_deref().unwrap_or("")
                ))
            }
            _ => language_instruction,
        };

        let mut options = Options {
            cwd: cwd.clone(),
            permission_mode: Some(PermissionMode::AcceptEdits),
            model: Some(model.clone()),
            system_prompt: full_system_prompt,
            resume: resume_session_id.map(|s| s.to_string()),
            mcp_servers: Some(mcp_servers.clone()),
            ..Options::default()
        };
        options.can_use_tool = Some(Box::new(bridge));

        Ok(SpawnContext {
            model,
            options,
            expected_mcp_server,
        })
    }
}
