use std::collections::HashMap;
use std::fmt::{Display, Formatter};
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;
use tokio::sync::{mpsc, Mutex};

#[derive(Debug, Clone)]
pub struct RuntimeUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimePermissionMode {
    Default,
    AcceptEdits,
    BypassPermissions,
    Plan,
    DontAsk,
}

#[derive(Debug, Clone)]
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
    pub model: Option<String>,
    pub system_prompt: Option<String>,
    pub resume_session_id: Option<String>,
    pub mcp_servers: Option<HashMap<String, RuntimeMcpServerConfig>>,
    pub can_use_tool: Option<Box<dyn claude_agent_sdk_rs::CanUseTool>>,
}

impl Default for RuntimeSpawnConfig {
    fn default() -> Self {
        Self {
            cwd: PathBuf::new(),
            permission_mode: None,
            model: None,
            system_prompt: None,
            resume_session_id: None,
            mcp_servers: None,
            can_use_tool: None,
        }
    }
}

#[derive(Debug)]
pub struct RuntimeError(String);

impl Display for RuntimeError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for RuntimeError {}

impl From<claude_agent_sdk_rs::SdkError> for RuntimeError {
    fn from(value: claude_agent_sdk_rs::SdkError) -> Self {
        Self(value.to_string())
    }
}

#[derive(Debug, Clone)]
pub struct RuntimeEvent {
    metadata: RuntimeEventMetadata,
    kind: RuntimeEventKind,
}

#[derive(Debug, Clone)]
pub struct RuntimeEventMetadata {
    pub session_id: Option<String>,
    pub usage: Option<RuntimeUsage>,
    pub raw: Value,
}

#[derive(Debug, Clone)]
pub enum RuntimeEventKind {
    Init(RuntimeInitEvent),
    AssistantMessage {
        message: RuntimeAssistantMessage,
        parent_tool_use_id: Option<String>,
    },
    UserMessage {
        message: RuntimeUserMessage,
        parent_tool_use_id: Option<String>,
    },
    StreamEvent {
        event: RuntimeStreamEvent,
        parent_tool_use_id: Option<String>,
    },
    ToolUseSummary {
        data: Value,
    },
    Result,
    CompactBoundary,
    Other,
}

#[derive(Debug, Clone)]
pub struct RuntimeInitEvent {
    pub model: Option<String>,
    pub mcp_servers: Vec<RuntimeMcpServerStatus>,
}

#[derive(Debug, Clone)]
pub struct RuntimeAssistantMessage {
    pub model: Option<String>,
    pub content: Vec<RuntimeContentBlock>,
}

#[derive(Debug, Clone)]
pub struct RuntimeUserMessage {
    pub content: Vec<RuntimeUserContentBlock>,
}

#[derive(Debug, Clone)]
pub enum RuntimeContentBlock {
    Text {
        text: String,
    },
    Thinking {
        thinking: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    Other,
}

#[derive(Debug, Clone)]
pub enum RuntimeUserContentBlock {
    ToolResult {
        tool_use_id: Option<String>,
        is_error: bool,
        content: Value,
    },
    Other,
}

#[derive(Debug, Clone)]
pub enum RuntimeStreamEvent {
    MessageStart {
        model: Option<String>,
    },
    ContentBlockStart {
        index: u32,
        block: RuntimeContentBlock,
    },
    ContentBlockDelta {
        index: u32,
        delta: RuntimeContentDelta,
    },
    ContentBlockStop {
        index: u32,
    },
    Other,
}

#[derive(Debug, Clone)]
pub enum RuntimeContentDelta {
    Text { text: String },
    Thinking { thinking: String },
    InputJson { partial_json: String },
}

impl RuntimeEvent {
    pub fn new(metadata: RuntimeEventMetadata, kind: RuntimeEventKind) -> Self {
        Self { metadata, kind }
    }

    pub fn session_id(&self) -> Option<&str> {
        self.metadata.session_id.as_deref()
    }

    pub fn usage(&self) -> Option<&RuntimeUsage> {
        self.metadata.usage.as_ref()
    }

    pub fn is_result(&self) -> bool {
        matches!(self.kind, RuntimeEventKind::Result)
    }

    pub fn raw_json(&self) -> &Value {
        &self.metadata.raw
    }

    pub fn init(&self) -> Option<&RuntimeInitEvent> {
        match &self.kind {
            RuntimeEventKind::Init(init) => Some(init),
            _ => None,
        }
    }

    pub fn assistant_message(&self) -> Option<&RuntimeAssistantMessage> {
        match &self.kind {
            RuntimeEventKind::AssistantMessage { message, .. } => Some(message),
            _ => None,
        }
    }

    pub fn user_message(&self) -> Option<&RuntimeUserMessage> {
        match &self.kind {
            RuntimeEventKind::UserMessage { message, .. } => Some(message),
            _ => None,
        }
    }

    pub fn parent_tool_use_id(&self) -> Option<&str> {
        match &self.kind {
            RuntimeEventKind::AssistantMessage {
                parent_tool_use_id, ..
            }
            | RuntimeEventKind::UserMessage {
                parent_tool_use_id, ..
            }
            | RuntimeEventKind::StreamEvent {
                parent_tool_use_id, ..
            } => parent_tool_use_id.as_deref(),
            _ => None,
        }
    }

    pub fn stream_event(&self) -> Option<&RuntimeStreamEvent> {
        match &self.kind {
            RuntimeEventKind::StreamEvent { event, .. } => Some(event),
            _ => None,
        }
    }

    pub fn tool_use_summary_data(&self) -> Option<&Value> {
        match &self.kind {
            RuntimeEventKind::ToolUseSummary { data } => Some(data),
            _ => None,
        }
    }

    pub fn is_compact_boundary(&self) -> bool {
        matches!(self.kind, RuntimeEventKind::CompactBoundary)
    }
}

pub type RuntimeMessageRx = mpsc::Receiver<Result<RuntimeEvent, RuntimeError>>;
pub type RuntimeSessionHandle = Arc<Mutex<Box<dyn AgentRuntimeSession>>>;

#[async_trait]
pub trait AgentRuntimeSession: Send + Sync {
    fn take_message_rx(&mut self) -> RuntimeMessageRx;
    async fn session_id(&self) -> Option<String>;
    async fn stream_input(&self, content: Value) -> Result<(), RuntimeError>;
    async fn interrupt(&self) -> Result<(), RuntimeError>;
    async fn close(&mut self);
    async fn set_model(&self, model: &str) -> Result<(), RuntimeError>;
    async fn set_permission_mode(&self, mode: RuntimePermissionMode) -> Result<(), RuntimeError>;
    fn pid(&self) -> Option<u32>;
}

#[async_trait]
pub trait AgentRuntimeAdapter: Send + Sync {
    async fn spawn(
        &self,
        content: Value,
        config: RuntimeSpawnConfig,
    ) -> Result<Box<dyn AgentRuntimeSession>, RuntimeError>;
}
