use serde::{Deserialize, Serialize};

// --- Commands payloads ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandsGetPayload {
    pub cwd: String,
    /// Runtime provider for the active session (e.g. `"claude_code"`,
    /// `"opencode"`). Required so command discovery is scoped to the active
    /// provider instead of falling back to shared filesystem scans.
    pub provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlashCommandPayload {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub kind: SlashCommandKindPayload,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlashCommandKindPayload {
    Command,
    Skill,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandsListPayload {
    pub commands: Vec<SlashCommandPayload>,
    /// `true` when the server is currently re-resolving the catalog in
    /// the background (the FE returned cached data instantly; a fresh
    /// `commands.updated` envelope will follow when the probe
    /// completes). The FE renders a small spinner / loader while this
    /// is set so the user knows the picker is being refreshed.
    #[serde(default)]
    pub refreshing: bool,
}

/// Server → Client: live slash-command catalog the agent advertised
/// over the runtime stream (today: ACP `available_commands_update`).
///
/// Emitted whenever a `RuntimeEventKind::SlashCommandsUpdated` arrives
/// on a session's runtime channel. The full catalog is sent every time
/// — frontends should replace, not merge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandsUpdatedPayload {
    pub commands: Vec<SlashCommandPayload>,
}
