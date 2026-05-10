use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionStatus {
    Active,
    Idle,
    Completed,
    Other(String),
}

impl SessionStatus {
    pub fn from_str(raw: &str) -> Self {
        match raw {
            "active" | "running" | "busy" | "retry" => Self::Active,
            "idle" | "paused" => Self::Idle,
            "completed" | "done" => Self::Completed,
            other => Self::Other(other.to_string()),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Session {
    pub id: String,
    pub title: Option<String>,
    pub directory: String,
    pub status: SessionStatus,
    pub parent_id: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MessageRole {
    User,
    Assistant,
    System,
    Other(String),
}

impl MessageRole {
    pub(crate) fn from_str(raw: &str) -> Self {
        match raw {
            "user" => Self::User,
            "assistant" => Self::Assistant,
            "system" => Self::System,
            other => Self::Other(other.to_string()),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TokenCacheUsage {
    pub read: u64,
    pub write: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TokenUsage {
    pub total: Option<u64>,
    pub input: u64,
    pub output: u64,
    pub reasoning: u64,
    pub cache: TokenCacheUsage,
}

impl TokenUsage {
    pub fn total_input(&self) -> u64 {
        self.input + self.cache.read + self.cache.write
    }

    /// Returns true when all token counters are zero (no real usage data yet).
    pub fn is_zero(&self) -> bool {
        self.input == 0
            && self.output == 0
            && self.reasoning == 0
            && self.cache.read == 0
            && self.cache.write == 0
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum MessagePart {
    Text {
        id: String,
        text: String,
    },
    ToolUse {
        id: String,
        tool_id: String,
        name: String,
        input: Value,
    },
    ToolResult {
        id: String,
        tool_use_id: String,
        is_error: bool,
        content: Value,
    },
    Thinking {
        id: String,
        thinking: String,
    },
    StepFinish {
        id: String,
        reason: String,
    },
    Other(Value),
}

impl MessagePart {
    pub fn id(&self) -> Option<&str> {
        match self {
            Self::Text { id, .. }
            | Self::ToolUse { id, .. }
            | Self::ToolResult { id, .. }
            | Self::Thinking { id, .. }
            | Self::StepFinish { id, .. } => Some(id.as_str()),
            Self::Other(_) => None,
        }
    }

    pub fn is_subtask_launch(&self) -> bool {
        matches!(
            self,
            Self::ToolUse { name, .. } if matches!(name.as_str(), "Task" | "Agent")
        )
    }

    pub fn expects_tool_result(&self) -> bool {
        matches!(
            self,
            Self::ToolUse { name, .. }
                if matches!(
                    name.as_str(),
                    "Bash"
                        | "Read"
                        | "Write"
                        | "Edit"
                        | "Glob"
                        | "Grep"
                        | "ApplyPatch"
                        | "TodoWrite"
                        | "WebFetch"
                        | "WebSearch"
                        | "Skill"
                        | "ToolSearch"
                )
        )
    }

    pub fn requires_follow_up_work(&self) -> bool {
        self.expects_tool_result() || self.is_subtask_launch()
    }

    pub fn is_terminal_stop(&self) -> bool {
        matches!(self, Self::StepFinish { reason, .. } if reason == "stop")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Message {
    pub id: String,
    pub session_id: String,
    pub role: MessageRole,
    pub parts: Vec<MessagePart>,
    pub created_at: Option<String>,
    pub model: Option<String>,
    pub tokens: Option<TokenUsage>,
    pub finished: bool,
}

impl Message {
    pub fn is_terminal_turn_message(&self) -> bool {
        self.finished && !self.parts.iter().any(MessagePart::requires_follow_up_work)
    }
}

#[derive(Debug, Clone)]
pub struct PermissionRequest {
    pub id: String,
    pub session_id: String,
    pub call_id: Option<String>,
    pub tool_name: String,
    pub tool_input: Value,
    pub description: Option<String>,
}

#[derive(Debug, Clone)]
pub struct QuestionOption {
    pub label: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone)]
pub struct QuestionItem {
    pub question: String,
    pub header: Option<String>,
    pub options: Option<Vec<QuestionOption>>,
    pub multiple: bool,
}

#[derive(Debug, Clone)]
pub struct Question {
    pub id: String,
    pub session_id: String,
    pub questions: Vec<QuestionItem>,
}

#[derive(Debug, Clone)]
pub enum SseEvent {
    SessionCreated(Session),
    SessionUpdated(Session),
    SessionDeleted {
        session_id: String,
    },
    MessageCreated(Message),
    MessageUpdated(Message),
    PartCreated {
        session_id: String,
        message_id: String,
        part: MessagePart,
    },
    PartUpdated {
        session_id: String,
        message_id: String,
        part: MessagePart,
    },
    PartDelta {
        session_id: String,
        message_id: String,
        part_id: String,
        field: String,
        delta: String,
    },
    PermissionCreated(PermissionRequest),
    PermissionUpdated {
        id: String,
        status: String,
    },
    QuestionCreated(Question),
    QuestionUpdated {
        id: String,
        status: String,
    },
    ServerConnected,
    Unknown(Value),
}

impl SseEvent {
    pub fn session_id(&self) -> Option<&str> {
        match self {
            SseEvent::SessionCreated(session) | SseEvent::SessionUpdated(session) => {
                Some(&session.id)
            }
            SseEvent::SessionDeleted { session_id } => Some(session_id),
            SseEvent::MessageCreated(message) | SseEvent::MessageUpdated(message) => {
                Some(&message.session_id)
            }
            SseEvent::PartCreated { session_id, .. } | SseEvent::PartUpdated { session_id, .. } => {
                Some(session_id)
            }
            SseEvent::PartDelta { session_id, .. } => Some(session_id),
            SseEvent::PermissionCreated(request) => Some(&request.session_id),
            SseEvent::QuestionCreated(question) => Some(&question.session_id),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRef {
    #[serde(rename = "providerID")]
    pub provider_id: String,
    #[serde(rename = "modelID")]
    pub model_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Command {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub template: Option<String>,
    #[serde(default)]
    pub subtask: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PromptOptions {
    pub model: Option<ModelRef>,
    pub agent: Option<String>,
    pub system: Option<String>,
    pub variant: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionReply {
    Once,
    Always,
    Reject,
}

#[derive(Debug, Clone)]
pub enum PromptPart {
    Text {
        text: String,
    },
    File {
        mime: String,
        filename: Option<String>,
        url: String,
    },
    Raw(Value),
}

impl PromptPart {
    pub fn into_value(self) -> Value {
        match self {
            PromptPart::Text { text } => serde_json::json!({
                "type": "text",
                "text": text,
            }),
            PromptPart::File {
                mime,
                filename,
                url,
            } => {
                let mut value = serde_json::json!({
                    "type": "file",
                    "mime": mime,
                    "url": url,
                });
                if let Some(filename) = filename {
                    value["filename"] = Value::String(filename);
                }
                value
            }
            PromptPart::Raw(value) => value,
        }
    }
}

// -- /config/providers wire shapes -------------------------------------------
//
// `GET /config/providers` on the embedded HTTP backend of `opencode
// serve` returns the providers/models opencode resolved from
// models.dev + on-disk config. Pure config listing — no upstream model
// API calls, no token usage. Service-side probe shapes these into the
// provider-neutral `ProviderCatalogEntry`.
//
// `default` is wired as `{ providerID: modelID }` (one entry per
// provider) — *not* a single `ModelRef`. The service picks one based
// on its own selection policy.

/// Top-level response for `GET /config/providers`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ConfigProvidersResponse {
    pub providers: Vec<ConfigProvider>,
    #[serde(default)]
    pub default: std::collections::HashMap<String, String>,
}

/// A single provider entry. `models` is sent over the wire as
/// `{ "model-id": {…} }` and flattened here into a vec with the map key
/// injected as `id`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ConfigProvider {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, deserialize_with = "deserialize_model_map")]
    pub models: Vec<ConfigProviderModel>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ConfigProviderModel {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub limit: Option<ConfigModelLimit>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ConfigModelLimit {
    #[serde(default)]
    pub context: Option<u64>,
    #[serde(default)]
    pub output: Option<u64>,
}

/// Deserialize the wire-side `{ "model-id": { … } }` map into a
/// `Vec<ConfigProviderModel>`, injecting each map key as the `id` of
/// the corresponding entry.
fn deserialize_model_map<'de, D>(deserializer: D) -> Result<Vec<ConfigProviderModel>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    struct ModelBody {
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        limit: Option<ConfigModelLimit>,
    }

    let map: std::collections::HashMap<String, ModelBody> = Deserialize::deserialize(deserializer)?;
    Ok(map
        .into_iter()
        .map(|(id, body)| ConfigProviderModel {
            id,
            name: body.name,
            limit: body.limit,
        })
        .collect())
}

#[cfg(test)]
mod config_providers_tests {
    use super::*;

    #[test]
    fn config_providers_response_round_trips() {
        let raw = serde_json::json!({
            "providers": [
                {
                    "id": "anthropic",
                    "name": "Anthropic",
                    "models": {
                        "claude-sonnet-4-5": {
                            "name": "Claude Sonnet 4.5",
                            "limit": { "context": 200000, "output": 64000 }
                        }
                    }
                }
            ],
            "default": { "anthropic": "claude-sonnet-4-5" }
        });

        let parsed: ConfigProvidersResponse = serde_json::from_value(raw).expect("parse");
        assert_eq!(parsed.providers.len(), 1);
        let provider = &parsed.providers[0];
        assert_eq!(provider.id, "anthropic");
        assert_eq!(provider.name.as_deref(), Some("Anthropic"));
        assert_eq!(provider.models.len(), 1);
        let model = &provider.models[0];
        assert_eq!(model.id, "claude-sonnet-4-5");
        assert_eq!(model.name.as_deref(), Some("Claude Sonnet 4.5"));
        let limit = model.limit.as_ref().expect("limit");
        assert_eq!(limit.context, Some(200_000));
        assert_eq!(limit.output, Some(64_000));
        assert_eq!(
            parsed.default.get("anthropic").map(String::as_str),
            Some("claude-sonnet-4-5"),
        );
    }

    #[test]
    fn config_providers_handles_missing_limit() {
        let raw = serde_json::json!({
            "providers": [
                {
                    "id": "local",
                    "models": {
                        "default": {}
                    }
                }
            ]
        });

        let parsed: ConfigProvidersResponse = serde_json::from_value(raw).expect("parse");
        let model = &parsed.providers[0].models[0];
        assert_eq!(model.id, "default");
        assert!(model.limit.is_none());
        assert!(parsed.default.is_empty());
    }
}
