# Provider status — OpenCode (ACP)

Status of the OpenCode adapter against [`FEATURES.md`](./FEATURES.md).

The adapter lives in `packages/service/src/domain/agents/opencode/` and
runs `opencode acp` as a child process, speaking the
**Agent Client Protocol** (line-delimited JSON-RPC 2.0 over stdio). The
provider-neutral runtime is in `packages/service/src/domain/agents/acp/`
and is shared with future ACP providers; OpenCode-specific behaviour
plugs in through the `AcpProviderHooks` trait
(`opencode/acp/adapter.rs`).

There is also a legacy HTTP/SSE transport
(`opencode/{session,stream_loop,stream_supervisor,…}`). The
`OpenCodeTransport` selector in `opencode/transport.rs` is now hardcoded
to ACP — `opencode_transport_env` ignores
`CADENCR_OPENCODE_TRANSPORT` and always returns `Acp`. The HTTP arms in
`opencode/mod.rs` survive as unreachable dead code pending a follow-up
removal. This document covers the ACP transport only.

> **This adapter is a freshly-landed first cut.** Many features are
> wired but have known bugs that block parity with the spec. The
> matrix below reflects the post-audit state of the branch
> `feature/opencode-acp-runtime-path-*`. Items marked 🟡 work in narrow
> cases; items marked ❌ have a user-visible regression or are not
> wired at all.

## Status matrix

| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Modes: plan / build / accept-edits | ✅ | Both spawn-time and mid-session paths wired. `negotiate_session` parses `currentModeId` from `session/new`; `apply_initial_permission_mode` pushes the user-selected mode to the agent post-handshake when it differs. `mode_switch::send_set_mode` capability-probes `session/set_mode` via `request_optional_method` so older builds degrade to a warn log instead of a raw RPC error. |
| 2 | Thinking | ✅ | `agent_thought_chunk` mapped to `RuntimeContentDelta::Thinking` with sticky indices in `EventIndexer`. |
| 3 | Partial / streaming messages | 🟡 | Streams correctly. `message_started` resets on **every** `tool_call_update` even when no streaming blocks were drained, fragmenting one assistant turn into multiple chat bubbles. |
| 4 | Bash tool calls + outputs | ✅ | `terminal/create` + enrich pipeline works correctly. |
| 5 | Edits / Writes / Patch | ✅ | `Edit` and `Write` both work correctly. **Tool descriptions are not visible** — Read, Grep, and other tools render without their description text in the UI. |
| 6 | Sub-agents | 🟡 | `parent_tool_use_id` plumbed. **`subAgentSessionId` is mis-mapped to `parent_tool_use_id`** (the FE expects a tool_use_id, gets a session id; child events drop on the floor). No `thread_id → parent_tool_use_id` registry; spec § 6 child final-text synthesis under the parent `Agent` block is missing. |
| 7 | Todo | 🟡 | `TodoWrite` and `plan` updates normalized to canonical shape. **`last_todowrite_call_id` is never reset across turns** — once any turn sees a TodoWrite, every subsequent `plan` update for the rest of the session is silently dropped. **Reverse-order plan-then-tool_call duplicates the UI.** |
| 8 | Thinking level changes | ✅ | `set_thinking_effort` wired through `session/set_config_option { configId: "effort", type: "string", value }` with legacy ride-along fallback. `apply_initial_thinking_effort` (`spawn_initial_config.rs`) pushes effort to the agent right after `session/new`, so the first turn already reflects the user's selection. `current_effort` starts as `None` (decoupled from intent) and is only written when the agent acks. |
| 9 | Model selection changes | ✅ | `set_model` and `apply_initial_model` (`spawn_initial_config.rs`) both send `session/set_config_option { configId: "model", type: "string", value }` — the schema OpenCode actually accepts (top-level `configId`/`type`/`value`, *not* a nested `configOption` envelope). `current_model` starts as `None` and is only written once the agent has acknowledged, so the short-circuit is keyed off real acknowledgement rather than Cadencr's intent. The "Talking to gpt-5.4-mini while the prompt says gpt-5.4" regression is fixed. |
| 10 | Permissions: yes / no / always / session | 🟡 | Bridge pattern wired via `permission_bridge`; question sidecar HTTP endpoint functional. **Deny on a question hangs the agent** (`respond_permission_fallback` early-returns when both `updated_input` and `feedback` are `None`, never calling `reject_tool_call`). **`AllowForSession` collapses onto `AllowFuture`** on the WS wire (a "session" decision is routed back to ACP as a permanent grant). Close cancellation uses JSON-RPC `-32800` instead of the spec'd `outcome: cancelled`. |
| 11 | MCP | ❌ | **MCP servers do not load.** OpenCode reads MCP config from `opencode.json` on disk regardless of transport; the ACP spawn path skips the `ensure_worktree_opencode_config` step the HTTP path runs. Plus `mcp_status_list` reports every configured server as `connected` before any health probe (spec § 11 status field is meaningless). |
| 12 | Plan approval | ❌ | **Not implemented at all.** No code synthesises an `ExitPlanMode` `ToolUse`. `AcpRuntimeSession::permission_response_kind` is not overridden, so it defaults to `Normal`; `should_transition_after_plan_approval` always returns `false`. Plan-approval bar never closes after Approve; session stays in plan. |
| 13 | Context usage | 🟡 | Window plumbed correctly through `RuntimeEventMetadata.context_window`. **`usage_update.used` (cumulative occupancy) is mis-treated as per-turn `input_tokens`**, garbling the FE's `used / context_window` math. `output_tokens` are forced to `0` on every snapshot. Wire shape used by `parse_prompt_response_usage` (`{inputTokens,outputTokens,thoughtTokens}`) is unverified against the real `opencode acp` reply. |
| 14 | Compaction | ❌ | `compaction_strategy` returns `LiveRuntime`, but `AcpRuntimeSession::compact()` is **not overridden** so `/compact` errors with "compaction is not supported". **No code emits `RuntimeEventKind::CompactBoundary` from ACP** — the FE `compact_divider` block never renders. |
| 15 | Command + skill list | 🟡 | Filesystem commands listed via `OpenCodeClient::list_commands_in_directory` — which **boots `opencode serve` even in ACP-only mode** (wastes a port + process; breaks for users without HTTP support). The agent-pushed `available_commands_update` notification is mapped to `Other` and discarded — mid-session command catalog never reaches the FE. Built-in commands (`/help`, `/init`, `/share`, …) are missing from the menu. |
| 16 | Replay / send-target detection | ❌ | **CONFIRMED BUG (user-reported).** `resume_session_id` is always discarded by design (`lifecycle.rs` ignores it; `is_valid_resume_session_id` not overridden). Conversation continuity broken across turns: a follow-up message that requires context from earlier in the conversation reports "I have no context about this." Likely cause: `OpenCodeAdapter::session_finished_text` dispatches to the HTTP-side prober even in ACP mode, returning stale data from an HTTP server that never received the conversation; the WS-layer dispatch then treats the slot as drained and starts a new turn without the prior history. Needs root-cause investigation. |

Legend: ✅ implemented · 🟡 partial · ❌ missing.

---

## Per-feature behavior

### 1. Modes: plan / build / accept-edits

`AcpProviderHooks::mode_for_permission_mode` (`opencode/acp/adapter.rs`)
maps Cadencr modes onto OpenCode's two primary agents:

| Cadencr mode | OpenCode mode id |
|---|---|
| `Plan` | `plan` |
| `Default` / `AcceptEdits` | `build` |
| `BypassPermissions` / `Auto` / `DontAsk` | rejected by `supports_permission_mode` |

Mid-session, `AcpRuntimeSession::set_permission_mode` issues
`session/set_mode { sessionId, modeId }` and updates the local
`current_mode` lock on success. `current_mode_update` notifications from
the agent mirror the value back through
`event_loop_state::sync_session_state_from_update`.

At spawn, `lifecycle::negotiate_session` parses `modes.currentModeId`
from the `session/new` response and threads it through
`NegotiatedSession.current_mode`, which `AcpRuntimeSession::assemble`
uses to seed the local `current_mode` lock (falling back to `"build"`
only when the agent omits the field). `spawn_initial_mode::apply_initial_permission_mode`
then runs post-handshake: if `config.permission_mode` resolves to a
non-default mode, it calls `set_session_mode` to push the user's
selection to the agent before the first prompt. `set_session_mode` /
`send_set_mode` capability-probe `session/set_mode` via
`request_optional_method`, so older builds without the method log a
warn and continue rather than surfacing a raw RPC error.

> Plan mode in OpenCode is read-only — there is no plan-approval gate.
> Toggling between Plan and Build via the chip above the prompt routes
> through `handle_mode_set → set_session_mode` in real time.

### 2. Thinking

The runtime distinguishes thinking from text via the outer notification
kind (`agent_thought_chunk` vs `agent_message_chunk`) and via the inner
content `type` (`thinking` vs `text`). `EventIndexer` keeps independent
sticky indices for each so consecutive same-kind chunks stitch onto the
same block, and a kind switch emits `ContentBlockStop` for the stale
side before opening the new block.

OpenCode does not expose a "summary" form of reasoning; whatever the
agent emits is forwarded verbatim.

### 3. Partial / streaming messages

`session/update agent_message_chunk` drives `RuntimeContentDelta::Text`;
`agent_thought_chunk` drives `RuntimeContentDelta::Thinking`. Indexes
are assigned by `EventIndexer` because ACP does not carry one.
`message_start_for` synthesises the per-message envelope when
`indexer.message_started` is `false`. `prepend_streaming_stops` closes
open text/thinking blocks before a tool call or plan update opens. Turn
completion is funnelled through `turn_lifecycle::finalize_turn`, which
drains any still-open blocks before emitting the `Result` envelope.

**Known issues:**

- *`message_started` reset on every tool_call_update.* `events.rs:99-100`
  flips the flag to `false` even when no Stop events were prepended.
  Every benign status update fragments the assistant turn into a fresh
  chat bubble. **Fix:** wrap in `if !events.is_empty() { … }`.
- *Tool blocks never drained on cancel/error.* `finalize_turn` only
  drains text/thinking; if a turn ends `cancelled` with a `tool_call`
  still in flight, the FE never sees `ContentBlockStop` for that index
  and the `EventIndexer.tool_indices` map keeps the stale id.

### 4. Bash tool calls + outputs

ACP splits Bash into a `terminal/create` server-request (which carries
`command + args`) and a `tool_call` whose `content[]` contains a
`{type: "terminal", terminalId}` reference. The adapter:

1. `terminal/create` spawns a child via the per-session `TerminalRegistry`
   (sandboxed to `session.cwd`; ACP `env` array shape with backward-compat
   warning for the legacy object form).
2. `enrich_session_update` (`server_requests.rs::handle_notification`)
   resolves `terminalId → (command, output)` from the registry, injects
   `toolInput.command` if missing, and replaces the `terminal` content
   entry with a `{type: "text", text: <output>}` block.
3. `flatten_tool_result_content` collapses the resulting array into a
   string the FE BashBlock renders directly.

Bash tool calls and outputs are fully functional.

### 5. Edits / Writes / Patch

`adapter_normalize::normalize_edit_input` rewrites ACP's camelCase keys
(`oldText`, `newText`, `filePath`) into the canonical Anthropic-style
snake_case keys (`old_string`, `new_string`, `file_path`) the Cadencr
diff renderer expects. `events_tool_call_input::synthesize_input_delta_event`
fills empty `toolInput`s by walking `content[]` for a `diff` block and
synthesising `{file_path, old_string, new_string}` (or `{file_path,
content}` for `Write`). Both `Edit` and `Write` render correctly.

**Known issues:**

- *Tool descriptions not visible.* Tools such as `Read`, `Grep`, and
  others render without their description text in the UI — the
  description field is missing or not surfaced from the ACP payload.

### 6. Sub-agents

The runtime extracts a parent linkage from
`parentToolCallId` / `parentToolUseId` / `subAgentSessionId` and stamps
it onto every event via `RuntimeEvent::set_parent_tool_use_id`. The FE
nests child events under the parent tool block.

**Known issues:**

- *`subAgentSessionId` is mis-mapped.* The FE looks up
  `parent_tool_use_id` in a tool_use map; a child *session* id will
  never key into that map. **Fix:** drop `subAgentSessionId` from the
  fallback chain, or maintain a `child_session_id → parent_tool_use_id`
  registry per spec § 6 and translate before stamping.
- *No registry for concurrent children.* Spec § 6 requires
  `thread_id → parent_tool_use_id` mapping for the lifetime of the
  parent turn.
- *Child final text not synthesised under parent.* Spec § 6 explicitly
  requires it when the provider only delivers final text via a tool
  result.
- *`Task` / `Agent` input not derived from content.*
  `derive_input_from_content` only handles `Edit`/`Write`/`MultiEdit`/
  `ApplyPatch`. Sub-agent panel renders without prompt context if
  OpenCode emits `Task` with empty `toolInput`.

### 7. Todo

Two paths produce a `TodoWrite` block:

1. Direct `tool_call(todowrite)` — `record_tool_name` stamps
   `last_todowrite_call_id`.
2. `session/update plan` — `events_plan::map_plan` synthesises an
   `AssistantMessage` with a `TodoWrite` `ToolUse`, using
   `last_todowrite_call_id` as a dedup gate.

Status values are normalised to snake_case; entries with no
`activeForm` reuse `content` as a fallback (acceptable per spec, ugly
in the UI).

**Known issues:**

- *`last_todowrite_call_id` never reset.* Once any turn records a
  TodoWrite, every subsequent `plan` update across the entire session
  is silently dropped. **Fix:** reset in `drain_open_blocks` (turn end).
- *Reverse-order ordering bug.* If `plan` arrives before
  `tool_call(todowrite)`, both produce TodoWrite blocks → duplicate UI.

### 8. Thinking level changes

`AcpRuntimeSession::set_thinking_effort` calls
`set_config_option_thinking_effort` which sends
`session/set_config_option { configId: "effort", type: "string", value }`.
On `MethodNotFound (-32601)` the runtime flips
`supports_set_config_option` to `false` and falls back to a legacy
ride-along under `_meta.thinkingEffort` on the next `session/prompt`.
`config_option_update` notifications mirror the agent's authoritative
value back into `current_effort`.

`spawn_initial_config::apply_initial_thinking_effort` runs immediately
after `session/new` (alongside `apply_initial_permission_mode`), so the
first turn already reflects the user's selection rather than the
agent's default. `current_effort` starts as `None` so the
short-circuit in `value_is_already_current` does not suppress the
spawn-time push — see § 9 for the same architectural pattern applied to
model. The `configId` discriminator on the wire is `"effort"` (not
`"thinkingEffort"`); the translation lives in
`set_config_option_thinking_effort`.

**Known issues:**

- *`applies_thinking_effort_in_place` is `true` on ACP.* The WS handler
  immediately stamps `spawned_thinking_effort` to the new value; an
  in-flight turn still uses the old value, causing a brief desync
  between DB and runtime.

### 9. Model selection changes

`AcpRuntimeSession::set_model` calls `set_config_option_model` which
sends `session/set_config_option { configId: "model", type: "string", value }`
with the same `MethodNotFound` fallback path as effort.
`spawn_initial_config::apply_initial_model` runs the same call right
after `session/new` so the first turn already runs against the user's
selection.

**Wire schema (verified against `opencode acp 1.14.44`).** Top-level
discriminators — *not* nested under a `configOption` envelope:

```json
{
  "sessionId": "...",
  "configId": "model",
  "type": "string",
  "value": "openai/gpt-5.4"
}
```

OpenCode's handler validates `configId` ∈ {`model`, `effort`, `mode`}
and rejects any other shape with `-32602 Invalid params`. The schema
was reverse-engineered from the binary at `setSessionConfigOption`.

**Decoupling Cadencr's intent from the agent's acknowledgement.**
`current_model` (and `current_effort`) start as `None`, *not* seeded
from `RuntimeSpawnConfig.model`. They flip to the user's selection only
after `set_config_option_model` has actually run — either via a
successful agent ack, or via the `MethodNotFound` fallback that still
writes the value locally so the legacy ride-along path can carry it on
the next prompt. This kills the previous regression where:

> User reported: "Talking to gpt-5.4-mini but the prompt says I'm
> using gpt-5.4 (even after model change)."

Pre-seeding meant the very first `set_config_option` call short-circuited
on `current_model == new_model` and never reached the wire. Decoupling
makes the short-circuit fire only when the agent has *actually* been
told.

`accepts_model` uses `is_opencode_model_ref` which requires a
`provider/model` shape — bare ids will not be routed to OpenCode.

### 10. Permissions: yes / no / always / session

OpenCode follows the canonical ACP permission flow:
`session/request_permission` → `dispatch_permission_request` →
runtime channel as a `opencode_permission_request` envelope (parsed
back by `OpenCodeAdapter::parse_permission_request`) → user decision →
`AcpRuntimeSession::respond_permission` → `acp_permission_response_payload`
with `{ outcome: { outcome: "selected", optionId } }`.

ACP's five canonical option kinds map to four runtime decisions:

| ACP kind | RuntimePermissionDecision |
|---|---|
| `allow_once` | `AllowOnce` |
| `allow_for_session` | `AllowForSession` |
| `allow_always` | `AllowFuture` |
| `reject_once` / `reject_always` | `Deny` |

`SessionPermissions` caches `AllowForSession` and `AllowFuture` grants
keyed by `(tool_name, canonical_input)` for the session's lifetime, but
the cache is never consulted (`lookup` is `#[allow(dead_code)]`).

The OpenCode-specific `AskUserQuestion` tool is routed through a
side-channel: `OpenCodeAcpAdapter::tool_call_update_override` synthesises
an `opencode_permission_request` envelope from the `rawInput.questions`
payload, and `respond_permission_fallback` posts the user's answer to
the question sidecar HTTP endpoint via `QuestionSidecar`.

**Known issues:**

- *Deny on a question hangs the agent.* `respond_permission_fallback`
  early-returns `Ok(false)` when both `updated_input` and `feedback` are
  `None` — exactly the case for a no-feedback Deny. The runtime emits
  "no pending ACP permission for request_id …" and the agent waits
  forever. **Fix:** route `Deny` to `reject_tool_call` regardless of
  payload.
- *`AllowForSession` collapsed onto wire `AllowFuture`.* `protocol.rs`
  has only three wire discriminants. A "session" decision is routed
  back to the agent as a permanent grant (different `optionId`s
  preserve the distinction agent-side, but the runtime-cached intent
  is wrong).
- *`reject_all_pending` on close.* Uses `-32800` JSON-RPC error rather
  than `acp_permission_cancel_payload()`. Some agents may treat that
  as a fatal RPC failure.
- *No pre-flight short-circuit.* `SessionPermissions::lookup` is
  unused; the agent re-prompts even after the user said "Always".

### 11. MCP

`build_stdio_mcp_payload` (`acp/runtime/mcp.rs`) emits the
schema-correct ACP shape: `{ args: [], env: [{name, value}] }` per
server, sorted by name for determinism. `negotiate_session` includes
this in `session/new`. `mcp_status_list` synthesises the init-event
status array.

**Known issues:**

- *MCP servers do not load.* OpenCode reads MCP config from
  `opencode.json` on disk regardless of transport. The HTTP path calls
  `mcp_config::ensure_worktree_opencode_config(&config.cwd, servers)`
  before spawning the server; the ACP path (`opencode/acp/mod.rs::spawn_acp_session`)
  skips this entirely. Cadencr-managed MCP tools won't work at all.
  **Fix:** call `ensure_worktree_opencode_config` from the ACP spawn
  path before launching the subprocess.
- *Status field is meaningless.* `mcp_status_list` marks every
  configured server as `connected` before any health probe. A bad
  config produces a green badge until the user tries the tool.
  **Fix:** report `pending` initially; flip on first list/error.
- *No hot-swap.* `set_mcp_servers` is unimplemented for ACP; the
  session must be re-spawned to change MCP config.

### 12. Plan approval

Per spec § 12, the adapter MUST surface a `RuntimeContentBlock::ToolUse`
with name `ExitPlanMode` and gate it through the permission channel as
a `PlanApproval` request. On approve, transition the session to a
build mode.

**Known issue: not implemented at all.**

Grep across `agents/{acp,opencode}` finds zero references to
`ExitPlanMode` or `RuntimePermissionResponseKind::PlanApproval`.
`AcpRuntimeSession::permission_response_kind` is not overridden, so it
defaults to `Normal`. `should_transition_after_plan_approval`
(`post_plan_mode.rs`) always returns `false`. The plan-approval bar
in the FE never closes after Approve; the session stays in `plan` mode
indefinitely.

**Fix:** mirror Codex (`event_items.rs:209-229`):

1. When the agent's `Plan` item completes, synthesise an
   `ExitPlanMode` `ToolUse` block with `input.plan` set to the plan
   text.
2. Override `permission_response_kind` on `AcpRuntimeSession` to return
   `PlanApproval` for that synthetic request id.
3. On `Allow`, issue an internal `set_permission_mode` to the
   adapter-chosen post-approval mode (today, that's `AcceptEdits` for
   OpenCode — see `default_permission_mode_wire`).

### 13. Context usage

Three sources populate `RuntimeEventMetadata.context_window`:

1. **At handshake** — `OpenCodeAdapter::context_window_for_model`
   resolves the model via the OpenCode catalog before
   `negotiate_session`.
2. **`usage_update` notifications** — `body.size` updates the window;
   `body.used` updates per-turn usage.
3. **`session_info_update` notifications** — `body.contextWindow.{tokenUsed,maxTokens}`.

Per-turn usage is parsed from the `session/prompt` response body by
`turn_result::parse_prompt_response_usage`, which folds `thoughtTokens`
into `output_tokens`.

**Known issues:**

- *`usage_update.used` mis-treated as `input_tokens`.* `used` is the
  cumulative context occupancy, not the current turn's input. Treating
  it as `input_tokens` garbles the FE's `used / context_window` math
  and forces `output_tokens` to `0` on every snapshot.
- *Wire shape unverified.* `parse_prompt_response_usage` reads
  `{inputTokens,outputTokens,thoughtTokens}` based on a comment about
  `opencode acp 1.14`. OpenCode's HTTP path uses
  `tokens.{input,output,reasoning}`; if ACP follows HTTP rather than
  ACP convention, per-turn usage drops on the floor. Add a real-fixture
  test.

### 14. Compaction

`OpenCodeAdapter::compaction_strategy` returns `LiveRuntime` for ACP
(the comment says: until OpenCode's ACP advertises `loadSession`,
`SummaryReplay` would silently lose context).

**Known issues — feature is non-functional:**

- *`AcpRuntimeSession::compact()` is not overridden.* The trait
  default returns `Err("compaction is not supported")`. User `/compact`
  surfaces that error.
- *No emission of `RuntimeEventKind::CompactBoundary`.* Grep across
  `agents/{acp,opencode}` finds no producer. The FE's compact_divider
  block never renders during ACP turns. Provider-initiated compaction
  signals from OpenCode (if any) are dropped.

**Fix:** implement `compact()` to issue OpenCode's `/compact` via
`session/prompt` (or whatever ACP exposes). When `usage_update.used`
drops sharply between consecutive notifications, or when the agent
explicitly signals compaction, emit
`RuntimeEventKind::CompactBoundary { trigger, pre_tokens }`.

### 15. Command + skill list

`OpenCodeAdapter::runtime_slash_commands` lists filesystem commands by
calling `OpenCodeClient::list_commands_in_directory(cwd)` over HTTP.

**Known issues:**

- *HTTP server boots even in ACP-only mode.* `OpenCodeClient::init()`
  spawns `opencode serve`. The ACP transport doesn't need that server
  for anything; this wastes a port and a long-lived process and breaks
  for users without HTTP support. **Fix:** in ACP mode, scan
  `.opencode/command/` directly and union with the agent-pushed
  catalog (next item).
- *`available_commands_update` notification is dropped.* Mapped to
  `Other` in `events.rs::session_update_to_events`; the agent's
  mid-session command catalog never reaches the FE. **Fix:** parse
  `availableCommands` into `RuntimeSlashCommand` and surface via a
  new `RuntimeEventKind` (e.g. `SlashCommandsUpdated`) the WS bridge
  can broadcast.
- *Built-in commands missing.* The HTTP `list_commands_in_directory`
  path doesn't surface OpenCode's built-ins (`/help`, `/init`,
  `/share`, …) — they only arrive via `available_commands_update`,
  which is dropped.

### 16. Replay / send-target detection

`AcpRuntimeSession::stream_input` sends `session/prompt` with the
session id captured at handshake. `prompt_turn_lock` serialises
concurrent `stream_input` calls behind the in-flight turn.
`OpenCodeAdapter::session_finished` returns `false` for ACP because
process exit is signalled separately via `AcpEvent::ProcessExited`.

`lifecycle.rs::negotiate_session` ignores `resume_session_id` because
"ACP sessions are subprocess-scoped" — `session/load` for unknown ids
hangs silently rather than erroring.

**Known issues — confirmed user-reported bug:**

> User: "Conversation continuity. I sent a first message, quick
> response, then a message that took into account the agent could read
> the whole conversation, but he says 'I have no context about this'."

Symptoms point to a follow-up turn losing access to the prior turn's
history. Hypothesised causes (need root-cause investigation before
fixing):

1. **`OpenCodeAdapter::session_finished_text` dispatches to the
   HTTP-side prober even in ACP mode** (`opencode/mod.rs:206-208`).
   The HTTP server has no record of the ACP-only conversation, so the
   prober may return a stale "session looks done" answer that causes
   the WS dispatch layer to treat the slot as drained and start a new
   turn without prior history. **Fix:** dispatch
   `session_finished_text` per-transport too (return `None` in ACP
   mode).
2. **Subprocess respawn between turns.** Nothing in the spawn path
   should respawn while the session is alive, but if the
   `AcpEvent::ProcessExited` path fires spuriously (e.g. the dispatcher
   loop misses a heartbeat), the WS layer will resurrect the session
   with a fresh subprocess — and a fresh ACP session id with no memory.
3. **`resume_session_id` always discarded.** Even on intentional reload
   (close/reopen the app), the ACP runtime always starts a fresh
   session. `is_valid_resume_session_id` is not overridden, so a stale
   id passes through and is then silently ignored.

**Fix path:** rule out #1 first by overriding `session_finished_text`
on the OpenCode adapter to return `None` for ACP. Then trace the WS
dispatch logic to confirm it's not respawning between turns.

---

## Architectural / spec-conformance gaps

Issues that don't fit a single feature row:

1. **`AcpProviderHooks::flatten_tool_result_content` has no default
   implementation.** Every future ACP provider must reimplement
   text-joining from scratch. The `PlainHooks` test fixture shows the
   recipe; lift it into the trait as a default.
2. **`is_valid_resume_session_id` not overridden on the OpenCode
   adapter.** The default returns `true`, so a stale resume id passes
   through and is then ignored by `lifecycle.rs` — masking the
   missing-resume problem from upstream.
3. **`reserve_local_port` TOCTOU race.** The reserved listener is
   dropped before `opencode acp` binds the port; another process can
   steal it on busy machines, producing intermittent
   "address already in use" failures. Pass the listener fd, or
   accept-and-handoff in-process.
4. **`session/prompt` 1-hour timeout vs. `session/cancel` race.**
   `interrupt()` notifies `session/cancel` and returns, but the held
   `prompt_turn_lock` only releases when the agent's reply lands. If
   the agent is wedged, the next prompt blocks for up to 60 minutes.
   Race the prompt future against a cancel-completion oneshot.
5. **HTTP transport dead code.** `opencode_transport_env` is hardcoded
   to `Acp`; `OpenCodeTransport::Http` and the `match` arms in
   `opencode/mod.rs` (`compaction_strategy`, `session_finished`,
   `session_finished_text`, `is_valid_resume_session_id`,
   `resolve_resume_session_id`, the spawn fallthrough) are unreachable.
   Excise the variant + the dead arms + the `providers::opencode::*`
   HTTP adapter as a follow-up cleanup.
6. **`OpenCodeAdapter::session_finished_text` always uses the HTTP
   prober.** Returns stale/wrong text in ACP mode (see § 16 above).
7. **`opencode acp --hostname --port` flag-set is not version-gated.**
   Older OpenCode binaries reject these flags and spawn fails with a
   cryptic error. Discover a minimum version or fall back to disabling
   the question tool with a warning.

---

## Suggested fix order

**Round 1 — must-fix to even smoke-test reliably:**

- § 11 — wire `ensure_worktree_opencode_config` into the ACP spawn path.
- § 12 — synthesise `ExitPlanMode` + override
  `permission_response_kind`.
- § 16 / Architecture #7 — return `None` from `session_finished_text`
  in ACP mode and trace the conversation-continuity regression.
- § 10 — route `Deny` to `reject_tool_call` unconditionally.

**Round 2 — visible UX bugs in normal use:**

- § 3 — guard the `message_started` reset.
- § 13 — stop mis-treating `usage_update.used` as `input_tokens`.
- § 7 — reset `last_todowrite_call_id` per turn.
- § 14 — implement `compact()` and emit `CompactBoundary`.
- § 15 — surface `available_commands_update`; skip HTTP boot in ACP.
- § 5 — surface tool descriptions (Read, Grep, …) from the ACP payload.

**Round 3 — edge cases and future-provider polish:**

- § 10 — wire `AllowForSession` distinct from `AllowFuture` end-to-end.
- § 6 — child-session registry; child-final-text synthesis.
- § 16 — durable-session strategy when OpenCode advertises
  `loadSession`.
- Architecture #1 — provide a default `flatten_tool_result_content`.
- Architecture #3 — fix the `reserve_local_port` TOCTOU.
- Architecture #4 — race the prompt timeout against cancellation.
