# OpenCode Provider — Implementation Plan

## Overview

Add OpenCode as a fully functional provider in Cadencr, on par with Claude Code. OpenCode runs as a headless HTTP+SSE server (`opencode serve`), so unlike Claude Code (stdio JSON streams), integration is network-based. We'll create a new Rust SDK crate (`opencode-sdk-rs`) that wraps OpenCode's HTTP/SSE API and implements the same `AgentRuntimeAdapter` / `AgentRuntimeSession` traits.

**Key architectural insight:** A single `opencode serve` instance handles multiple sessions across multiple directories. Directory scoping is per-request (via `x-opencode-directory` header or `?directory=` query param). Model and agent are per-prompt, not per-server. This means Cadencr runs **one shared OpenCode server** — no port management or multi-process complexity.

**Scope boundaries:** Authentication and OpenCode configuration (API keys, LLM providers) are the user's responsibility. Cadencr assumes OpenCode is installed, configured, and the user has already provided their API keys. We reuse existing sessions and don't touch auth.

---

## 1. OpenCode Architecture (Reference)

| Aspect | Detail |
|--------|--------|
| Runtime | TypeScript on Bun, Effect runtime, Hono HTTP framework |
| DB | SQLite (Drizzle ORM) — sessions, messages, parts |
| Protocol | HTTP REST + SSE (no WebSocket) |
| Default port | Tries `4096` first, falls back to OS-assigned ephemeral if busy |
| CLI modes | `opencode serve` (headless), `opencode run` (non-interactive), `opencode acp` (stdin/stdout nd-JSON) |
| Auth | Optional HTTP Basic Auth via `OPENCODE_SERVER_PASSWORD` env var (not our concern) |
| OpenAPI spec | `GET /doc` |
| SDK | `@opencode-ai/sdk` (TypeScript, Stainless-generated) — no Rust SDK exists |
| Multi-dir | Single server handles all directories; `x-opencode-directory` header per request |
| Model | Per-prompt: `{ providerID, modelID }` in prompt payload |
| Agent | Per-prompt: `agent` field in prompt payload ("build", "plan", "general", "explore") |

### Key API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/global/health` | Health check |
| GET | `/event` | SSE event bus (all session events) |
| POST | `/session` | Create session |
| GET | `/session/:id` | Get session |
| DELETE | `/session/:id` | Delete session |
| POST | `/session/:id/message` | Send prompt (sync, blocks until complete) |
| POST | `/session/:id/prompt_async` | Send prompt (fire-and-forget, 204) |
| GET | `/session/:id/message` | Message history |
| GET | `/session/:id/children` | Child sessions (subagents) |
| POST | `/session/:id/abort` | Abort active prompt (cancels without killing server) |
| GET | `/session/status` | All session statuses |
| GET | `/permission` | List pending permission requests |
| POST | `/permission/:requestID/reply` | Approve/deny permission |
| GET | `/question` | List pending questions |
| POST | `/question/:requestID/reply` | Answer question |
| POST | `/question/:requestID/reject` | Reject question |
| GET | `/config` | Get config |
| PATCH | `/config` | Update config |
| GET | `/config/providers` | List LLM providers |
| GET | `/agent` | List available agents |

### Prompt Payload (`POST /session/:id/prompt_async`)

```typescript
{
  parts: [{ type: "text", text: "..." }, ...],  // content (text, file, agent, subtask)
  model?: { providerID: string, modelID: string },  // per-prompt model override
  agent?: string,          // "build", "plan", "general", "explore"
  system?: string,         // system prompt override
  format?: { ... },        // response format
  noReply?: boolean,       // fire without waiting for LLM response
}
```

### Session Create Payload (`POST /session`)

```typescript
{
  parentID?: string,       // for sub-sessions
  title?: string,
  permission?: { ... },    // permission ruleset
  workspaceID?: string,
}
```

Note: No `model`, `agent`, or `system_prompt` on session creation — these are prompt-level concerns.

### SSE Event Types

The `/event` endpoint streams nd-JSON events. Key event types:
- `session.created`, `session.updated`, `session.deleted`
- `message.created`, `message.updated`, `message.part.created`, `message.part.updated`
- `permission.created`, `permission.updated`
- `question.created`, `question.updated`
- `server.connected` (initial handshake)

### OpenCode Agents

| Agent | Description | Permissions |
|-------|-------------|-------------|
| **build** | Full access — edit, bash, all tools `allow` | Unrestricted |
| **plan** | Read-only by default — `edit` and `bash` are `ask` | Restricted |
| **general** | Subagent — full tools, multi-step research | Unrestricted |
| **explore** | Subagent — read-only, cannot write | Read-only |

---

## 2. New Crate: `opencode-sdk-rs`

Create `packages/opencode-sdk-rs/` as a Rust library crate in the workspace.

### 2.1 Crate Structure

```
packages/opencode-sdk-rs/
├── Cargo.toml
└── src/
    ├── lib.rs          # Public API re-exports
    ├── client.rs       # HTTP client (reqwest) — all API endpoints
    ├── sse.rs          # SSE stream consumer (reqwest-eventsource)
    ├── types.rs        # API types (sessions, messages, parts, permissions, questions)
    ├── error.rs        # Error types
    └── process.rs      # Spawn/manage the singleton `opencode serve` process
```

No `permissions.rs` — OpenCode handles permissions internally; we just proxy its SSE events.

### 2.2 Dependencies

```toml
[dependencies]
reqwest = { version = "0.12", features = ["json"] }
reqwest-eventsource = "0.6"    # SSE via reqwest
tokio = { version = "1", features = ["process", "sync", "rt"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
async-trait = "0.1"
tracing = "0.1"
thiserror = "2"
```

### 2.3 Core Types

```rust
// types.rs

pub struct Session {
    pub id: String,
    pub title: Option<String>,
    pub directory: String,
    pub status: SessionStatus,
    pub parent_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub enum SessionStatus { Active, Idle, Completed }

pub struct Message {
    pub id: String,
    pub session_id: String,
    pub role: MessageRole,
    pub parts: Vec<MessagePart>,
    pub created_at: String,
}

pub enum MessageRole { User, Assistant, System }

pub enum MessagePart {
    Text { id: String, text: String },
    ToolUse { id: String, tool_id: String, name: String, input: Value },
    ToolResult { id: String, tool_use_id: String, is_error: bool, content: Value },
    Thinking { id: String, thinking: String },
    Other(Value),
}

pub struct PermissionRequest {
    pub id: String,
    pub session_id: String,
    pub tool_name: String,
    pub tool_input: Value,
    pub description: Option<String>,
}

pub struct Question {
    pub id: String,
    pub session_id: String,
    pub text: String,
    pub options: Option<Vec<String>>,
}

pub enum SseEvent {
    SessionCreated(Session),
    SessionUpdated(Session),
    MessageCreated(Message),
    MessageUpdated(Message),
    PartCreated { session_id: String, message_id: String, part: MessagePart },
    PartUpdated { session_id: String, message_id: String, part: MessagePart },
    PermissionCreated(PermissionRequest),
    PermissionUpdated { id: String, status: String },
    QuestionCreated(Question),
    QuestionUpdated { id: String, status: String },
    ServerConnected,
    Unknown(Value),
}

/// Per-prompt options (model + agent are per-prompt in OpenCode)
pub struct PromptOptions {
    pub model: Option<ModelRef>,
    pub agent: Option<String>,
    pub system: Option<String>,
}

pub struct ModelRef {
    pub provider_id: String,
    pub model_id: String,
}
```

### 2.4 Singleton Process Management

Since one OpenCode server handles everything, we need a singleton process manager:

```rust
// process.rs

use std::sync::Arc;
use tokio::sync::Mutex;

/// Singleton manager for the shared `opencode serve` process.
/// Cadencr spawns one server and all sessions share it.
pub struct OpenCodeServer {
    child: tokio::process::Child,
    port: u16,
    pid: u32,
}

/// Global singleton — lazily spawned on first use, kept alive for the app lifetime.
static SERVER: once_cell::sync::Lazy<Arc<Mutex<Option<OpenCodeServer>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(None)));

impl OpenCodeServer {
    /// Ensure the shared server is running. Returns the port.
    /// If already running, returns immediately. If not, spawns `opencode serve`.
    pub async fn ensure_running() -> Result<u16, SdkError>;

    /// Spawn `opencode serve` (no explicit --port → tries 4096, falls back to ephemeral).
    /// Waits for `GET /global/health` to succeed before returning.
    async fn spawn() -> Result<Self, SdkError>;

    /// Get the actual port the server bound to.
    /// Parse from server stdout (OpenCode prints the URL on startup).
    pub fn port(&self) -> u16;

    pub fn pid(&self) -> u32;

    /// Kill the server. Called on Cadencr app shutdown.
    pub async fn shutdown() -> Result<(), SdkError>;
}
```

**Startup flow:**
1. First OpenCode session init → `OpenCodeServer::ensure_running()`
2. Spawns `opencode serve` (tries port 4096, falls back to ephemeral)
3. Parses actual port from stdout/health-check
4. All subsequent sessions reuse the same port
5. On Cadencr shutdown → `OpenCodeServer::shutdown()` kills the process

**Port discovery:** OpenCode's `serve` command prints the listening URL to stdout. Parse it. Alternatively, try `GET http://localhost:4096/global/health` first — if it responds, reuse the existing server (user may have started it manually).

### 2.5 HTTP Client

```rust
// client.rs

pub struct OpenCodeClient {
    base_url: String,
    http: reqwest::Client,
}

impl OpenCodeClient {
    /// Create client pointing to the shared server.
    pub fn new(port: u16) -> Self;

    // --- Directory-scoped requests (set x-opencode-directory header) ---

    pub async fn create_session(&self, directory: &str) -> Result<Session, SdkError>;
    pub async fn get_session(&self, id: &str, directory: &str) -> Result<Session, SdkError>;
    pub async fn list_sessions(&self, directory: &str) -> Result<Vec<Session>, SdkError>;
    pub async fn delete_session(&self, id: &str) -> Result<(), SdkError>;

    /// Fire-and-forget prompt. Model and agent are per-prompt.
    pub async fn prompt_async(
        &self,
        session_id: &str,
        parts: Vec<PromptPart>,
        options: PromptOptions,
    ) -> Result<(), SdkError>;

    // --- Permissions ---
    pub async fn list_permissions(&self) -> Result<Vec<PermissionRequest>, SdkError>;
    pub async fn reply_permission(
        &self,
        request_id: &str,
        allow: bool,
        message: Option<&str>,
    ) -> Result<(), SdkError>;

    // --- Questions ---
    pub async fn list_questions(&self) -> Result<Vec<Question>, SdkError>;
    pub async fn reply_question(&self, request_id: &str, answer: &str) -> Result<(), SdkError>;
    pub async fn reject_question(&self, request_id: &str) -> Result<(), SdkError>;

    // --- Session control ---
    /// Abort a running session. Cancels the active prompt without killing the server.
    pub async fn abort_session(&self, session_id: &str) -> Result<(), SdkError>;

    // --- Config (for model catalog) ---
    pub async fn get_providers(&self) -> Result<Vec<Value>, SdkError>;

    // --- SSE ---
    pub fn event_stream(&self) -> Result<SseStream, SdkError>;
}
```

### 2.6 SSE Stream

```rust
// sse.rs

pub struct SseStream {
    inner: reqwest_eventsource::EventSource,
}

impl SseStream {
    /// Connect to `GET /event` and yield parsed SseEvent items.
    /// Reconnects automatically on disconnect.
    pub async fn next(&mut self) -> Option<Result<SseEvent, SdkError>>;
}
```

**Session filtering:** The SSE stream carries events for ALL sessions on the server. The consumer in `OpenCodeSession` must filter by its own `session_id`. Use a shared SSE connection with a fan-out dispatcher (see §3.2).

### 2.7 SSE Fan-Out Dispatcher

Since all sessions share one SSE stream, we need a dispatcher:

```rust
// sse.rs (or dispatcher.rs)

/// Shared SSE dispatcher — one connection, many session consumers.
/// Spawned alongside the server singleton.
pub struct SseDispatcher {
    /// Map of session_id → sender channel
    subscribers: Arc<Mutex<HashMap<String, Vec<mpsc::Sender<SseEvent>>>>>,
}

impl SseDispatcher {
    /// Start consuming the SSE stream and dispatching to subscribers.
    pub async fn start(client: &OpenCodeClient) -> Result<Self, SdkError>;

    /// Subscribe to events for a specific session_id.
    /// Returns a receiver channel.
    pub async fn subscribe(&self, session_id: &str) -> mpsc::Receiver<SseEvent>;

    /// Unsubscribe when a session closes.
    pub async fn unsubscribe(&self, session_id: &str);

    /// Subscribe to permission events for ANY session (for global permission routing).
    pub async fn subscribe_permissions(&self) -> mpsc::Receiver<SseEvent>;
}
```

---

## 3. Service Integration: `OpenCodeAdapter`

### 3.1 New File: `packages/service/src/domain/agents/opencode.rs`

```rust
pub struct OpenCodeAdapter;
pub static OPENCODE_ADAPTER: OpenCodeAdapter = OpenCodeAdapter;

pub struct OpenCodeSession {
    client: opencode_sdk_rs::OpenCodeClient,
    dispatcher: Arc<opencode_sdk_rs::SseDispatcher>,
    session_id: String,
    directory: String,
    current_agent: String,           // "build" or "plan"
    current_model: Option<ModelRef>,
    event_rx: Option<mpsc::Receiver<SseEvent>>,  // taken once via take_message_rx
    server_pid: u32,
}
```

### 3.2 Trait Mapping

#### `AgentRuntimeAdapter::spawn`

```
1. OpenCodeServer::ensure_running() → get port
2. OpenCodeClient::new(port)
3. SseDispatcher — get or create the shared dispatcher
4. client.create_session(cwd) → session_id
   OR if resume_session_id: verify session exists via GET /session/:id
5. dispatcher.subscribe(session_id) → event_rx
6. client.prompt_async(session_id, content, PromptOptions { model, agent, system })
7. Return OpenCodeSession
```

#### `AgentRuntimeSession` methods

| Method | OpenCode Implementation |
|--------|------------------------|
| `take_message_rx()` | Spawn a Tokio task that reads from `event_rx`, runs events through `StreamSynthesizer` (§3.4), and outputs `RuntimeEvent` on a new channel |
| `session_id()` | Return OpenCode session ID |
| `stream_input(content)` | `client.prompt_async(session_id, parts, PromptOptions { model: current_model, agent: current_agent, system: None })` |
| `interrupt()` | `client.abort_session(session_id)` — cancels the active prompt via `POST /session/:id/abort`. Session stays alive. |
| `close()` | `dispatcher.unsubscribe(session_id)`. Don't kill the server (shared). |
| `set_model(model)` | Parse `"provider/model"` → `ModelRef { provider_id, model_id }`. Store in `current_model`. Takes effect on next prompt. |
| `set_permission_mode(mode)` | Map mode to agent: `Plan` → `"plan"`, everything else → `"build"`. Store in `current_agent`. Takes effect on next prompt. |
| `pid()` | Return `server_pid` |

### 3.3 SSE → RuntimeEvent Mapping

The `take_message_rx` task converts filtered SSE events to RuntimeEvent variants:

| SSE Event | RuntimeEvent |
|-----------|-------------|
| `server.connected` | `Init { model, mcp_servers: [] }` |
| `message.created` (role=assistant) | `StreamEvent::MessageStart { model }` + full `AssistantMessage` fallback |
| `message.part.created` (text) | `StreamEvent::ContentBlockStart { index: N, Text }` |
| `message.part.updated` (text) | `StreamEvent::ContentBlockDelta { index: N, Text { delta } }` |
| `message.part.created` (tool-invocation) | `StreamEvent::ContentBlockStart { index: N, ToolUse { id, name } }` |
| `message.part.updated` (tool-invocation) | `StreamEvent::ContentBlockDelta { index: N, InputJson { delta } }` |
| `message.part.created` (thinking) | `StreamEvent::ContentBlockStart { index: N, Thinking }` |
| `message.part.updated` (thinking) | `StreamEvent::ContentBlockDelta { index: N, Thinking { delta } }` |
| `message.created` (role=user, tool results) | `UserMessage { content: [ToolResult { ... }] }` |
| `session.updated` (status=idle) | `ContentBlockStop` for all open indices, then `Result` |
| `permission.created` | **Not emitted as RuntimeEvent** — handled by permission bridge (§4) |
| `question.created` | **Not emitted as RuntimeEvent** — handled as AskUserQuestion (§4.3) |

### 3.4 Partial Message Streaming (Critical)

The frontend (`ws-message-processing.ts`) drives its streaming UI through a strict block lifecycle:

```
message_start → content_block_start(index, type) → content_block_delta(index, delta)* → content_block_stop(index)
```

Each block is tracked by **numeric index** and a generated `blockId`. The frontend's `StreamingState` maps `index → blockId`, `toolUseId → index`, etc. Delta types must be exactly `text_delta`, `thinking_delta`, or `input_json_delta`. Parent-child nesting (subagents) uses `parent_tool_use_id`.

**OpenCode's model is different:** it uses `message.part.created` / `message.part.updated` with part IDs, and `message.created` for complete messages. There is no explicit start/delta/stop lifecycle.

**The SSE consumer must synthesize the full block lifecycle.** Here's how:

#### Index Tracking

The SSE consumer maintains per-message state:

```rust
struct StreamSynthesizer {
    /// Maps OpenCode part ID → assigned numeric index
    part_index: HashMap<String, u32>,
    /// Next available index
    next_index: u32,
    /// Tracks cumulative text per part (for computing deltas if updates are cumulative)
    part_text: HashMap<String, String>,
    /// Maps child session_id → parent_tool_use_id (for subagent nesting)
    child_session_parents: HashMap<String, String>,
}
```

#### Event Synthesis

| OpenCode SSE Event | Emitted RuntimeEvents |
|---|---|
| `message.created` (role=assistant) | `StreamEvent::MessageStart { model }` — resets index state |
| `message.part.created` (type=text) | `StreamEvent::ContentBlockStart { index: N, block: Text { text: "" } }` |
| `message.part.updated` (type=text) | `StreamEvent::ContentBlockDelta { index: N, delta: Text { text: <incremental> } }` |
| `message.part.created` (type=tool-invocation) | `StreamEvent::ContentBlockStart { index: N, block: ToolUse { id, name, input: {} } }` |
| `message.part.updated` (type=tool-invocation, input changed) | `StreamEvent::ContentBlockDelta { index: N, delta: InputJson { partial_json } }` |
| `message.part.created` (type=thinking) | `StreamEvent::ContentBlockStart { index: N, block: Thinking { thinking: "" } }` |
| `message.part.updated` (type=thinking) | `StreamEvent::ContentBlockDelta { index: N, delta: Thinking { thinking: <incremental> } }` |
| `message.created` (role=user, tool_result parts) | `UserMessage { content: [ToolResult { ... }] }` |
| `session.updated` (status=idle) | `ContentBlockStop` for all open indices, then `Result` |
| No equivalent | `CompactBoundary` — not emitted (OpenCode handles compaction internally) |

#### Cumulative vs Incremental Delta Handling

OpenCode may send cumulative text in `message.part.updated` (full text so far, not just the new chars). The SDK must handle both:

```rust
fn compute_delta(part_id: &str, new_text: &str, part_text: &mut HashMap<String, String>) -> String {
    let prev = part_text.get(part_id).map(|s| s.len()).unwrap_or(0);
    let delta = &new_text[prev..];
    part_text.insert(part_id.to_string(), new_text.to_string());
    delta.to_string()
}
```

If OpenCode sends only incremental deltas, the diff is a no-op (previous length is always current).

#### Subagent / Child Session Nesting

OpenCode spawns child sessions for subagents. The SSE stream includes events from all sessions. The consumer must:

1. On `session.created` with `parent_id`, look up the parent session's last tool_use block to find the `parent_tool_use_id`
2. Set `parent_tool_use_id` on all events from child sessions
3. Subscribe to child session events via the dispatcher
4. This enables the frontend's `parentToolUseId`-based nesting and `childBlocks` rendering

#### Complete Message Fallback

If streaming part events are missed (reconnect, race condition), the `message.created` event for a complete assistant message serves as a fallback. The SSE consumer emits a full `AssistantMessage` with all content blocks, which the frontend handles via `processAssistantMessage` (replace or append).

---

## 4. Permission System Mapping

### 4.1 Architecture Difference

| Aspect | Claude Code | OpenCode |
|--------|-------------|----------|
| Permission check | Cadencr server resolves via `CanUseTool` callback (in-process, sync, blocking) | OpenCode server resolves internally; emits `permission.created` SSE event when user input needed |
| Approval flow | Claude CLI blocks on stdin, Cadencr's `CanUseTool` intercepts and routes to WS | OpenCode blocks internally, waiting for `POST /permission/:id/reply` |
| Pattern caching | Cadencr manages `session_cache` + `settings.local.json` | OpenCode has its own `GrantPersistant` (session-scoped) |

### 4.2 Cadencr's Permission Bridge with OpenCode

**Strategy: Proxy OpenCode's permission requests through Cadencr's existing permission UI.**

1. SSE consumer sees `permission.created` event
2. Convert to Cadencr's `PermissionRequestPayload` and send via WS to frontend
3. Frontend shows the same permission dialog as Claude Code sessions
4. User responds (AllowOnce / AllowFuture / Deny)
5. Cadencr calls `client.reply_permission(request_id, allow, message)`
6. OpenCode unblocks and continues

**Key difference: no `CanUseTool` trait.** Since OpenCode resolves permissions server-side and only asks when needed, Cadencr doesn't need to implement `CanUseTool`. The `RuntimeSpawnConfig.can_use_tool` field is `None` for OpenCode sessions. Instead, the SSE consumer task handles permission events directly.

**Session cache + patterns:** Cadencr can optionally auto-reply to OpenCode permission requests using its own `session_cache` and `allowed_patterns`, without showing UI. This provides consistent behavior across providers:

```
SSE permission.created →
  check session_cache/allowed_patterns →
    if match: auto-reply allow via HTTP
    else: route to frontend WS
```

### 4.3 `AskUserQuestion` Mapping

OpenCode's `question.created` maps to Cadencr's `AskUserQuestion` tool:

1. SSE consumer sees `question.created`
2. Send as `PermissionRequestPayload` with `tool_name: "AskUserQuestion"` (already a `FRONTEND_PROMPT_TOOLS` entry)
3. User answers in the permission dialog
4. Cadencr calls `client.reply_question(request_id, answer)` or `client.reject_question(request_id)`

---

## 5. Plan Mode

### 5.1 How It Works in OpenCode

OpenCode has a dedicated "plan" agent that is read-only by default (`edit` and `bash` tools default to `ask`). The agent is selected **per-prompt** via the `agent` field. No session recreation needed to switch agents.

### 5.2 Mapping to Cadencr's Plan Mode

Cadencr's plan mode flow:
1. `RuntimePermissionMode::Plan` → agent enters plan-only mode
2. Agent calls `EnterPlanMode` tool → Cadencr persists `permission_mode = 'plan'`
3. Agent produces plan, calls `ExitPlanMode` with plan JSON → Cadencr persists `pending_plan_approval`, sends to frontend
4. User approves/requests changes → Cadencr unblocks agent

**For OpenCode — use the "plan" agent + system prompt:**

1. When `permission_mode == Plan`, send prompts with `agent: "plan"` and a system prompt instructing the agent to produce a structured plan (not execute)
2. When `permission_mode != Plan` (execute mode), send prompts with `agent: "build"`
3. Since agent is per-prompt, **switching between plan and execute happens seamlessly within the same session** — no recreation needed

**Plan detection and approval flow:**
1. Plan prompt sent with `agent: "plan"` + system prompt
2. Session goes idle (agent finished planning) → `session.updated` (status=idle)
3. Cadencr extracts the plan from the last assistant message
4. Persists `pending_plan_approval` and sends `permission.request` WS event to frontend
5. User approves → Cadencr sends follow-up prompt with `agent: "build"`: "Execute the plan above"
6. User requests changes → Cadencr sends feedback with `agent: "plan"`: "Revise the plan: <feedback>"

### 5.3 Plan Persistence and Approval

1. When plan is produced, persist to `agent_sessions.pending_plan_approval` (same as Claude Code)
2. Send `permission.request` WS event with `tool_name: "ExitPlanMode"` and plan JSON
3. On app restart, `session_init` restores pending plan approval from DB (existing flow, no changes needed)

---

## 6. Persistence and Resume

### 6.1 Session ID Mapping

| Cadencr Field | OpenCode Equivalent |
|---------------|---------------------|
| `agent_sessions.id` | Cadencr's internal DB ID (unchanged) |
| `agent_sessions.runtime_session_id` | OpenCode session ID (UUID) |
| `agent_sessions.claude_session_id` | Also stores OpenCode session ID (for resume) |
| `agent_sessions.runtime_provider` | `"opencode"` |

### 6.2 Resume Flow

OpenCode sessions are persistent (SQLite-backed). Resuming is straightforward:

1. On `session.init`, if `runtime_session_id` exists in DB:
   - `OpenCodeServer::ensure_running()` — spawns if not already running
   - The server discovers existing sessions from its own SQLite DB
   - Verify session still exists via `GET /session/:id` (with `x-opencode-directory` header)
   - `dispatcher.subscribe(session_id)` — start receiving events
   - Set `resume_session_id` in handle
2. On first prompt, send to the existing session via `prompt_async`
3. Full conversation history is preserved in OpenCode's DB — no `--resume` flag needed

### 6.3 Reconnect on App Restart

The existing `reconnect.rs` logic queries `agent_sessions WHERE status IN ('paused', 'running') AND claude_session_id IS NOT NULL`. For OpenCode:
- Same query works — `claude_session_id` stores the OpenCode session ID
- `restore_on_reconnect()` adds sessions to `paused_sessions` map
- On restore: `OpenCodeServer::ensure_running()`, verify sessions exist, subscribe to SSE
- When the user opens a feature, `session.init` picks up the stored session ID and resumes

### 6.4 Message Persistence

Cadencr persists messages independently in its own DB. The SSE consumer writes:
- User messages (from `message.created` with role=user)
- Assistant messages (from `message.created` with role=assistant)
- Tool calls and results (from part events)
- Streaming deltas (from `message.part.updated`)

This mirrors what `WsSessionPersistence` already does for Claude Code events. The `normalize_event` mapping ensures the persistence layer sees the same `RuntimeEvent` types regardless of provider.

---

## 7. WebSocket Session Integration

### 7.1 Session Init Changes

In `session_init.rs`, the check `if effective_provider != DEFAULT_PROVIDER` currently rejects non-Claude providers. Change to:

```rust
match effective_provider.as_str() {
    "claude_code" => { /* existing flow */ },
    "opencode" => { /* same SdkHandle structure, uses OpenCodeAdapter */ },
    other => { send_error(..., "UNSUPPORTED_PROVIDER", ...); return; }
}
```

The `SdkHandle` and `QueryState` structures are provider-agnostic — they work with `Box<dyn AgentRuntimeSession>`. No structural changes needed.

### 7.2 Session Prompt Changes

In `session_prompt.rs`, the `WsBridgeCanUseTool` is Claude-specific (implements `claude_agent_sdk_rs::CanUseTool`). For OpenCode:

- `RuntimeSpawnConfig.can_use_tool` is `None`
- Permission handling happens in the SSE consumer task instead
- The SSE consumer needs access to: `sender` (WS), `session_cache`, `allowed_patterns`, `write_pool`, `turn_state_tx`
- Factor out permission routing into a shared helper callable from both `WsBridgeCanUseTool` and the OpenCode SSE consumer

### 7.3 Interrupt

OpenCode provides a per-session abort endpoint: `POST /session/{sessionID}/abort`.

- Returns `200 true` (JSON boolean)
- Internally interrupts the Effect fiber via `Runner.cancel`
- Propagates through `abortSignal` to tool calls and spawned shell processes
- No request body needed
- Session remains alive and can receive new prompts afterward

This maps cleanly to `AgentRuntimeSession::interrupt()`:

```rust
async fn interrupt(&self) -> Result<(), RuntimeError> {
    self.client.abort_session(&self.session_id).await
        .map_err(RuntimeError::from)
}
```

No SIGINT, no server restart, no side effects on other sessions.

### 7.4 Model Selection

Model is per-prompt in OpenCode. `set_model(model_string)` on the session:
1. Parse the model string into `ModelRef { provider_id, model_id }` (format TBD — could be `"anthropic/claude-sonnet-4-20250514"` or separate fields)
2. Store in `OpenCodeSession.current_model`
3. Applied on the next `prompt_async` call

For the provider catalog, query `GET /config/providers` from the running OpenCode server. This returns the models the user has configured (depends on their API keys). Merge into the static catalog response.

**Catalog refresh flow:**
1. `provider_catalog()` returns static entries for Claude Code + a placeholder for OpenCode
2. New endpoint `GET /api/agent-catalog/refresh` (or on-demand) calls OpenCode's `/config/providers`
3. Updates the OpenCode entry with real models
4. Frontend calls refresh when user selects OpenCode provider

---

## 8. WS Feature Integration

### 8.1 Feature-Level Provider Settings

Already supported via `ProviderSettings` and the settings cascade (`resolve_setting`). No changes needed — the user selects "opencode" as the provider for a feature/project/workspace, and `session_init` picks it up.

### 8.2 Workflow Engine

The workflow engine (`domain/workflow/`) spawns multiple agents per feature (plan, execute, review, etc.). Each agent slot resolves its provider independently via `spawn_context.rs`.

For OpenCode workflow agents:
- All agent slots share the same OpenCode server (singleton)
- Each agent slot gets its own OpenCode session
- Model and agent type are per-prompt, so different workflow agents can use different models/agents within the same server
- The `WorkflowPermissionBridge` routes permission requests to the frontend — same flow works

---

## 9. Implementation Phases

### Phase 1: SDK Crate — Core

1. Create `packages/opencode-sdk-rs/` with `Cargo.toml`
2. `error.rs` — error types
3. `types.rs` — all API types (Session, Message, MessagePart, PermissionRequest, Question, SseEvent, PromptOptions, ModelRef)
4. `process.rs` — singleton server spawn/kill, port discovery, health check
5. `client.rs` — all HTTP endpoints with `x-opencode-directory` header support
6. `sse.rs` — SSE stream consumer + `SseDispatcher` fan-out
7. `lib.rs` — public API re-exports
8. Integration tests (requires `opencode` binary installed)

### Phase 2: Adapter + Streaming

1. Create `domain/agents/opencode.rs` — `OpenCodeAdapter` + `OpenCodeSession`
2. Implement `StreamSynthesizer` — SSE part events → RuntimeEvent block lifecycle
3. Implement `take_message_rx()` with full streaming pipeline
4. Register in `domain/agents/mod.rs` — `"opencode" => Some(&opencode::OPENCODE_ADAPTER)`
5. Update `runtime.rs` — change OpenCode status to `Available`
6. Remove the provider guard in `session_init.rs`

### Phase 3: Permission Bridge

1. Wire permission.created SSE events → Cadencr's `PermissionRequestPayload` → frontend WS
2. Wire question.created → `AskUserQuestion` flow
3. Add `session_cache` / `allowed_patterns` auto-reply for OpenCode permissions
4. Test: approve, deny, allow-future

### Phase 4: Plan Mode

1. Map `RuntimePermissionMode::Plan` → `agent: "plan"` per-prompt
2. Detect plan completion (session idle after plan prompt)
3. Extract plan from last assistant message, persist `pending_plan_approval`
4. Wire approval → follow-up prompt with `agent: "build"`
5. Wire rejection → feedback prompt with `agent: "plan"`
6. Test: plan → approve → execute cycle

### Phase 5: Persistence & Resume

1. Store OpenCode session ID in `runtime_session_id` / `claude_session_id`
2. Resume flow: `ensure_running()` → verify session → subscribe SSE → prompt
3. Reconnect on app restart: restore from DB, verify sessions exist
4. Handle edge cases: stale sessions, server already running externally

### Phase 6: Polish

1. Model catalog refresh from running OpenCode server (`/config/providers`)
2. Error recovery: server crashes, unreachable, permission timeout
4. Frontend: ensure provider switch works seamlessly
5. Update tests in `mod.rs`

---

## 10. Open Questions / Risks

| # | Question | Impact | Mitigation |
|---|----------|--------|------------|
| 1 | SSE event format for streaming text deltas — incremental or cumulative? | Correct delta computation | SDK handles both via `compute_delta`; verify empirically |
| 2 | OpenCode model string format — how to map Cadencr's flat model ID to `{ providerID, modelID }` | Model switching | Define a convention: `"anthropic/claude-sonnet-4-20250514"` → split on `/` |
| 3 | SSE reconnect behavior — does OpenCode replay missed events? | Streaming reliability | Use `message.created` fallback for complete messages; accept possible gaps in part-level streaming |
| 4 | Child session events — how to correlate with parent tool_use_id | Subagent nesting | Track `session.created` with `parent_id`, correlate with last tool call in parent session |

---

## 11. Adapter Trait Compatibility Notes

The `AgentRuntimeAdapter` trait has a `can_use_tool` field on `RuntimeSpawnConfig` typed as `Box<dyn claude_agent_sdk_rs::CanUseTool>`. This is Claude-specific.

**Approach:** Keep it optional (already `Option`). OpenCode sets it to `None`. The SSE consumer handles permissions directly via the dispatcher. No trait changes needed.

---

## 12. File Change Summary

| File | Change |
|------|--------|
| `packages/opencode-sdk-rs/` | **New crate** — HTTP client, SSE consumer, process manager, types |
| `packages/service/Cargo.toml` | Add `opencode-sdk-rs` dependency |
| `packages/service/src/domain/agents/opencode.rs` | **New** — adapter + session + StreamSynthesizer |
| `packages/service/src/domain/agents/mod.rs` | Register `"opencode"` adapter |
| `packages/service/src/domain/agents/runtime.rs` | Update catalog: status → Available, populate models |
| `packages/service/src/domain/ws_session/handler/session_init.rs` | Remove provider guard, support OpenCode init |
| `packages/service/src/domain/ws_session/handler/session_prompt.rs` | Factor out permission routing for reuse by OpenCode SSE consumer |
| `packages/service/src/domain/permission_bridge.rs` | Minor: support OpenCode permission events |
| `packages/service/src/domain/workflow/reconnect.rs` | Handle OpenCode resume (`ensure_running` + verify session) |
| `Cargo.toml` (workspace) | Add `opencode-sdk-rs` to workspace members |
