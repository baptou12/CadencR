//! SpawnContext construction and settings resolution for AgentManager.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::domain::agents::adapter::{RuntimePermissionMode, RuntimeSpawnConfig};
use crate::domain::agents::runtime::DEFAULT_PROVIDER;
use crate::domain::agents::runtime_adapter;
use crate::domain::mcp::servers::{mcp_server_name, AgentType};
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
    pub(super) async fn resolve_setting(
        &self,
        key: &str,
        project_id: Option<i64>,
        default: Option<&str>,
    ) -> Option<String> {
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
    pub(super) async fn resolve_model(
        &self,
        agent_type_str: &str,
        project_id: Option<i64>,
    ) -> String {
        const DEFAULT_MODEL: &str = crate::api::DEFAULT_MODEL;
        let db_key = format!("model_{agent_type_str}");
        self.resolve_setting(&db_key, project_id, Some(DEFAULT_MODEL))
            .await
            .unwrap_or_else(|| DEFAULT_MODEL.to_string())
    }

    /// Resolve the runtime provider for a given agent type.
    pub(super) async fn resolve_provider(
        &self,
        agent_type_str: &str,
        project_id: Option<i64>,
    ) -> String {
        let db_key = crate::domain::agents::runtime::runtime_setting_key(agent_type_str);
        self.resolve_setting(&db_key, project_id, Some(DEFAULT_PROVIDER))
            .await
            .unwrap_or_else(|| DEFAULT_PROVIDER.to_string())
    }

    /// Build a SpawnContext with all the shared setup: MCP config, CWD, permission
    /// bridge, model resolution, language instruction, and runtime spawn config.
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
        phase_slug: Option<&str>,
        input_phase_slugs: Option<&[String]>,
        model_override: Option<&str>,
    ) -> Result<SpawnContext, String> {
        let mcp_servers =
            build_mcp_server_config(agent_type, self.feature_id, phase_slug, input_phase_slugs);
        let expected_mcp_server = mcp_server_name(agent_type).to_string();

        let cwd = self.get_feature_cwd().await.ok_or_else(|| {
            format!(
                "No working directory found for feature {}. Was ensure_worktree called?",
                self.feature_id
            )
        })?;
        info!(feature_id = self.feature_id, agent_type = agent_type_str, cwd = %cwd.display(), "agent spawn CWD resolved");

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

        let project_id = self.get_project_id().await;
        let provider = self.resolve_provider(agent_type_str, project_id).await;
        if runtime_adapter(&provider).is_none() {
            return Err(format!(
                "Runtime provider '{provider}' is not implemented yet for workflow agents"
            ));
        }

        // Model — prefer explicit override (e.g. from workflow phase definition)
        let model = match model_override.filter(|s| !s.is_empty()) {
            Some(m) => m.to_string(),
            None => self.resolve_model(agent_type_str, project_id).await,
        };
        info!(feature_id = self.feature_id, agent_type = agent_type_str, provider = %provider, model = %model, "resolved agent runtime");

        if let Err(error) =
            sqlx::query("UPDATE agent_sessions SET runtime_provider = ?, model = ? WHERE id = ?")
                .bind(&provider)
                .bind(&model)
                .bind(db_session_id)
                .execute(&self.write_pool)
                .await
        {
            warn!(
                session_id = db_session_id,
                provider = %provider,
                model = %model,
                error = %error,
                "failed to persist resolved runtime provider/model before spawn"
            );
        }

        // Build system prompt with CWD hint + optional MCP instructions
        let cwd_hint = format!(
            "IMPORTANT: Your working directory is {}. All file operations, git commands, and tool calls MUST use this directory. Do NOT navigate to or operate in any other directory.",
            cwd.display()
        );
        let mcp_suffix = if include_mcp_instructions {
            "\n\n## MCP Tools\n\n\
             The MCP tools will auto-resolve plan_id from your feature — you do NOT need to pass plan_id to any tool. \
             Just omit it and the correct plan will be used automatically."
        } else {
            ""
        };
        let full_system_prompt = match system_prompt {
            Some(sp) if !sp.is_empty() => Some(format!("{cwd_hint}\n\n{sp}{mcp_suffix}")),
            _ => Some(cwd_hint),
        };

        let runtime_config = RuntimeSpawnConfig {
            cwd: cwd.clone(),
            permission_mode: Some(RuntimePermissionMode::AcceptEdits),
            model: Some(model.clone()),
            system_prompt: full_system_prompt,
            resume_session_id: resume_session_id.map(|s| s.to_string()),
            mcp_servers: Some(mcp_servers.clone()),
            permission_handler: Some(Arc::new(bridge)),
        };

        Ok(SpawnContext {
            provider,
            model,
            runtime_config,
            expected_mcp_server,
        })
    }
}
