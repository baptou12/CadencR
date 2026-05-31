use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use super::session::RuntimeToolPermissionHandler;

#[derive(Debug, Clone)]
pub struct RuntimeUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

impl RuntimeUsage {
    pub fn is_zero(&self) -> bool {
        self.input_tokens == 0 && self.output_tokens == 0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimePermissionMode {
    Default,
    AcceptEdits,
    BypassPermissions,
    Plan,
    /// Claude Code v2.1.83+ classifier-backed mode. Currently a Claude-only
    /// mode; OpenCode and Codex adapters fall back to their own "everyday"
    /// permission level when this is selected.
    Auto,
    DontAsk,
    OpenCodeAgent(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeAccessMode {
    Default,
    FullAccess,
    AutoReview,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum RuntimeMcpServerConfig {
    Stdio {
        command: String,
        args: Option<Vec<String>>,
        env: Option<HashMap<String, String>>,
    },
}

#[derive(Debug, Clone)]
pub struct RuntimeMcpServerStatus {
    pub name: String,
    pub status: String,
}

pub struct RuntimeSpawnConfig {
    pub cwd: PathBuf,
    pub permission_mode: Option<RuntimePermissionMode>,
    pub access_mode: Option<RuntimeAccessMode>,
    pub model: Option<String>,
    pub thinking_effort: Option<String>,
    pub system_prompt: Option<String>,
    pub resume_session_id: Option<String>,
    pub mcp_servers: Option<HashMap<String, RuntimeMcpServerConfig>>,
    pub permission_handler: Option<Arc<dyn RuntimeToolPermissionHandler>>,
    /// Extra env vars injected into the spawned runtime. Adapters decide how
    /// to apply this (Claude Code merges it into the CLI subprocess env;
    /// ACP-backed providers may ignore it when configuration is handled elsewhere).
    pub env: Option<HashMap<String, String>>,
}

impl Default for RuntimeSpawnConfig {
    fn default() -> Self {
        Self {
            cwd: PathBuf::new(),
            permission_mode: None,
            access_mode: None,
            model: None,
            thinking_effort: None,
            system_prompt: None,
            resume_session_id: None,
            mcp_servers: None,
            permission_handler: None,
            env: None,
        }
    }
}
