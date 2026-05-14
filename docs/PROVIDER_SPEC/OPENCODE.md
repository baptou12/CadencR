# Provider status — OpenCode (ACP)

Status of the OpenCode adapter against [`FEATURES.md`](./FEATURES.md).

The adapter lives in `packages/service/src/domain/agents/opencode/` and
runs `opencode acp` as a child process, speaking the
**Agent Client Protocol** (line-delimited JSON-RPC 2.0 over stdio). The
provider-neutral runtime is in `packages/service/src/domain/agents/acp/`
and is shared with future ACP providers; OpenCode-specific behaviour
plugs in through the `AcpProviderHooks` trait
(`opencode/acp/adapter.rs`).

The legacy long-lived OpenCode transport (`opencode/{session,removed stream supervisor modules,…}`) has been removed. The OpenCode adapter now routes through ACP. This document covers the ACP transport only.

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
| 3 | Partial / streaming messages | ✅ | Streams correctly. `message_started` is preserved for non-streaming no-op updates and only reset when an open streaming block is actually drained. |
| 4 | Bash tool calls + outputs | ✅ | `terminal/create` + enrich pipeline works correctly. |
| 5 | Edits / Writes / Patch | ✅ | `Edit` and `Write` both work correctly. **Tool descriptions are not visible** — Read, Grep, and other tools render without their description text in the UI. |
| 6 | Sub-agents | ✅ | `parent_tool_use_id` plumbed. `subAgentSessionId` is intentionally not treated as a parent tool id; OpenCode Task/Agent completions synthesize child final text under the parent tool block, and the side-channel listener maintains child-session to parent-tool mapping for live child messages. |
| 7 | Todo | ✅ | `TodoWrite` and `plan` updates normalized to canonical shape. Turn-scoped Todo dedup state is reset at turn end; reverse-order `plan` then empty `tool_call(TodoWrite)` suppresses the duplicate direct tool block. |
| 8 | Thinking level changes | ✅ | `set_thinking_effort` wired through `session/set_config_option { configId: "effort", type: "string", value }` with legacy ride-along fallback. OpenCode reasoning models such as `openai/gpt-5.4` now advertise supported effort levels in the catalog, so the FE renders the thinking-effort control. `apply_initial_thinking_effort` (`spawn_initial_config.rs`) pushes effort to the agent right after `session/new`, so the first turn already reflects the user's selection. `current_effort` starts as `None` (decoupled from intent) and is only written when the agent acks. |
| 9 | Model selection changes | ✅ | `set_model` and `apply_initial_model` (`spawn_initial_config.rs`) both send `session/set_config_option { configId: "model", type: "string", value }` — the schema OpenCode actually accepts (top-level `configId`/`type`/`value`, *not* a nested `configOption` envelope). `current_model` starts as `None` and is only written once the agent has acknowledged, so the short-circuit is keyed off real acknowledgement rather than Cadencr's intent. The "Talking to gpt-5.4-mini while the prompt says gpt-5.4" regression is fixed. |
| 10 | Permissions: yes / no / always / session | ✅ | Bridge pattern wired via `permission_bridge`; question sidecar HTTP endpoint functional. No-feedback Deny now routes to `reject_tool_call` instead of hanging. `AllowForSession` is preserved through the runtime response path, OpenCode fallback options carry `allow_for_session`, and cached session/always grants pre-flight repeated matching ACP requests. Close cancellation still uses JSON-RPC `-32800` rather than the spec's `outcome: cancelled`. |
| 11 | MCP | ❌ | **MCP servers do not load.** OpenCode reads MCP config from `opencode.json` on disk regardless of transport; the ACP spawn path skips the `ensure_worktree_opencode_config` step the HTTP path runs. `mcp_status_list` reports configured servers as `unknown` until a future health probe can provide observed status. |
| 12 | Plan approval | ❌ | **Not implemented at all.** No code synthesises an `ExitPlanMode` `ToolUse`. `AcpRuntimeSession::permission_response_kind` is not overridden, so it defaults to `Normal`; `should_transition_after_plan_approval` always returns `false`. Plan-approval bar never closes after Approve; session stays in plan. |
| 13 | Context usage | ✅ | Window plumbed through `RuntimeEventMetadata.context_window`. OpenCode context snapshots come from `usage_update.used/size` and `session_info_update.contextWindow`; per-turn `session/prompt` usage is no longer treated as context-budget usage. |
| 14 | Compaction | ✅ | `compaction_strategy` returns `LiveRuntime`; `AcpRuntimeSession::compact()` issues OpenCode `/compact` through `session/prompt` and emits a manual `RuntimeEventKind::CompactBoundary` so the FE compact divider renders and persists. |
| 15 | Command + skill list | ✅ | Slash menu merges Cadencr built-ins/skills with OpenCode's ACP `available_commands_update` catalog. Cold refresh uses a short-lived `opencode acp` probe, not `opencode serve`, and live sessions mirror catalog pushes into the per-cwd snapshot. |
| 16 | Replay / send-target detection | ✅ | Live ACP send-targeting is verified: follow-up prompts are routed through the active `AcpRuntimeSession::stream_input`, `session_finished` stays false for ACP turn completion, and the second turn retains prior-turn context. Stale resume ids are explicitly rejected for OpenCode because ACP sessions are subprocess-scoped; continuity after app/process restart is intentionally not claimed. |

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

Codex implementation notes:

- `subAgentSessionId` is intentionally excluded from the fallback chain
  because it carries a child session id, not a parent tool-use id.
- OpenCode `Task` / `Agent` completions synthesize a cleaned child text
  message under `parent_tool_use_id == <task tool_call_id>`.
- The OpenCode side-channel listener tracks `child_session_id →
  parent_tool_use_id` for live child messages.
- `Task` / `Agent` input can be derived from `content[]` when `toolInput`
  is empty, so the sub-agent panel has prompt context.

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

Codex implementation notes:

- `drain_open_blocks` resets turn-scoped Todo dedup state so one turn's
  `TodoWrite` cannot suppress later plan-only updates.
- If a `plan` update arrives before an empty duplicate
  `tool_call(TodoWrite)`, the direct tool call and later updates are
  suppressed to avoid duplicate Todo UI; non-empty TodoWrite input still
  renders as a real tool call.

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

OpenCode's model catalog marks known OpenAI reasoning models
(`gpt-5*`, `o1*`, `o3*`, `o4*`) as effort-capable with
`low` / `medium` / `high` / `xhigh`. The FE reads this catalog metadata
to render the `Cycle thinking effort` control in the model chip.
Browser QA with OpenCode `openai/gpt-5.4` verified the control appears,
cycles to `Low`, emits `session effort.set`, and the first runtime spawn
uses `desired_effort=Some("low")`.

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
keyed by `(tool_name, canonical_input)` for the session's lifetime.
Before surfacing a repeated matching ACP permission request, the event
loop consults this cache and responds directly to the agent with the
matching selected option id.

The OpenCode-specific `AskUserQuestion` tool is routed through a
side-channel: `OpenCodeAcpAdapter::tool_call_update_override` synthesises
an `opencode_permission_request` envelope from the `rawInput.questions`
payload, and `respond_permission_fallback` posts the user's answer to
the question sidecar HTTP endpoint via `QuestionSidecar`.

**Known issue:**

- *`reject_all_pending` on close.* Uses `-32800` JSON-RPC error rather
  than `acp_permission_cancel_payload()`. Some agents may treat that
  as a fatal RPC failure.

Codex implementation note: no-feedback Deny on the OpenCode
question-sidecar fallback now routes to `QuestionSidecar::reject_tool_call`
before the empty-payload early return. Browser QA verified a rejected
external file write clears the permission prompt and leaves the target
file absent. The WS payload still uses the existing `allow_future`
discriminant for the frontend button, but `option_id` now carries
`allow_for_session`/`session`, and `handle_permission_respond` maps that
back to `RuntimePermissionDecision::AllowForSession` before responding to
ACP.

### 11. MCP

`build_stdio_mcp_payload` (`acp/runtime/mcp.rs`) emits the
schema-correct ACP shape: `{ args: [], env: [{name, value}] }` per
server, sorted by name for determinism. `negotiate_session` includes
this in `session/new`. `mcp_status_list` synthesises the init-event
status array with `unknown` until a health probe exists.

**Known issues:**

- *MCP servers do not load.* OpenCode reads MCP config from
  `opencode.json` on disk regardless of the ACP `session/new` payload.
  The ACP path (`opencode/acp/mod.rs::spawn_acp_session`) still needs to
  write that file before launching the subprocess. Cadencr-managed MCP
  tools won't work at all without it.
  **Fix:** call `ensure_worktree_opencode_config` from the ACP spawn
  path before launching the subprocess.
- *Status field is conservative.* `mcp_status_list` reports configured
  servers as `unknown` because there is no health probe yet.
  **Fix:** flip the status on first successful list or first error once
  runtime-level MCP health is observable.
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
   `body.used` updates the cumulative context occupancy.
3. **`session_info_update` notifications** — `body.contextWindow.{tokenUsed,maxTokens}`.

Codex implementation notes:

- `usage_update.used` is represented as `input_tokens = used` and
  `output_tokens = 0` because the existing frontend bar computes
  `(input + output) / context_window`; this preserves the real context
  occupancy without inventing a second usage shape.
- `turn_result::emit_turn_result` keeps the raw `session/prompt` usage
  payload for inspection but does not attach it to `RuntimeEventMetadata`
  as context usage. That prevents small per-turn accounting from
  overwriting the cumulative context snapshot.
- Browser QA with OpenCode `openai/gpt-5.4` showed the context bar at
  `6%` and the DB row at `input_tokens=12497`, `output_tokens=0`,
  `context_window=200000`.

### 14. Compaction

`OpenCodeAdapter::compaction_strategy` returns `LiveRuntime` for ACP
(the comment says: until OpenCode's ACP advertises `loadSession`,
`SummaryReplay` would silently lose context).

Codex implementation notes:

- `AcpRuntimeSession::compact()` now sends `/compact` via `session/prompt`.
- After the compact prompt completes, ACP emits a manual
  `RuntimeEventKind::CompactBoundary` so the FE renders and persists the
  compact divider even when OpenCode returns only summary text.
- If OpenCode emits a `user_message_chunk` whose content type is
  `compaction`, the mapper also turns that provider marker into a compact
  boundary.
- Browser QA with OpenCode `openai/gpt-5.4` showed the summary text plus a
  `manual / Compacted` divider; the DB row had `was_compacted=1` and a
  `compact_divider` message with `{"trigger":"manual"}`.

### 15. Command + skill list

OpenCode command discovery is ACP-native:

- Live `available_commands_update` notifications are parsed into
  `RuntimeSlashCommand` values and forwarded as `commands.updated`.
- `OpenCodeAcpAdapter::record_available_commands` mirrors each live
  push into a per-cwd snapshot so synchronous `commands.get` calls can
  return immediately.
- Cold refresh uses a short-lived `opencode acp` subprocess that runs
  `initialize` / `session/new`, captures the first
  `available_commands_update`, stores the snapshot, and exits. It does
  not boot `opencode serve`.
- The resolver merges the OpenCode catalog with Cadencr commands and
  skills. Browser QA showed `/compact`, OpenCode built-ins (`/init`,
  `/review`), project commands (`/item-*`, `/finish-job`), and skills
  (`/qa`, `/db`) in the fresh OpenCode slash menu.

### 16. Replay / send-target detection

`AcpRuntimeSession::stream_input` sends `session/prompt` with the
session id captured at handshake. `prompt_turn_lock` serialises
concurrent `stream_input` calls behind the in-flight turn.
`OpenCodeAdapter::session_finished` returns `false` for ACP because
process exit is signalled separately via `AcpEvent::ProcessExited`.

`lifecycle.rs::negotiate_session` ignores `resume_session_id` because
"ACP sessions are subprocess-scoped" — `session/load` for unknown ids
hangs silently rather than erroring.

Codex verification notes:

- Active follow-up prompts reuse the live ACP session through
  `AcpRuntimeSession::stream_input`; the session id captured at
  handshake is used on each `session/prompt`.
- `OpenCodeAdapter::session_finished` always returns `false` for ACP
  turn completion, so the WS reconciler does not treat a completed turn
  as a completed runtime session. The trait default for
  `session_finished_text` therefore returns `None`, avoiding the old
  HTTP-side final-text probe path.
- `OpenCodeAdapter::is_valid_resume_session_id` and
  `resolve_resume_session_id` reject stored runtime session ids. That
  makes the unsupported restart-resume behavior explicit instead of
  passing a stale id into `lifecycle.rs`, where ACP ignores it.
- Browser QA with OpenCode `openai/gpt-5.4` created a fresh session,
  asked the agent to remember `ALPHA_CONTEXT_1131`, then asked a second
  turn to repeat it. The response was exactly
  `TOKEN ALPHA_CONTEXT_1131`, confirming live conversation continuity.

Known limitation: if the ACP subprocess is gone because the app or
service restarted, OpenCode does not currently restore that session from
the stored runtime id. Supporting that would require an upstream
load/replay mechanism; Cadencr currently starts a fresh ACP session in
that case.

---

## Architectural / spec-conformance gaps

Issues that don't fit a single feature row:

1. **`AcpProviderHooks::flatten_tool_result_content` has no default
   implementation.** Every future ACP provider must reimplement
   text-joining from scratch. The `PlainHooks` test fixture shows the
   recipe; lift it into the trait as a default.
2. **OpenCode ACP cannot resume after process restart.** Stored runtime
   session ids are rejected explicitly because `session/load` for an
   unknown ACP id hangs silently and OpenCode has no reliable ACP replay
   mechanism yet.
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
5. **Removed transport follow-through.** Keep future OpenCode work on the ACP path; do not reintroduce long-lived transport branches or SDK streaming payload types.
6. **OpenCode ACP session replay is missing.** Live follow-up turns keep
   context, but reopening after the subprocess dies starts a fresh ACP
   session by design until upstream exposes a reliable load/replay path.
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
- Architecture #6 — design a real restart replay/load path if upstream
  OpenCode ACP exposes one.

**Round 2 — visible UX bugs in normal use:**

- § 5 — surface tool descriptions (Read, Grep, …) from the ACP payload.

**Round 3 — edge cases and future-provider polish:**

- § 10 — use ACP's `outcome: cancelled` when closing pending
  permission requests.
- § 6 — child-session registry; child-final-text synthesis.
- § 16 — durable-session strategy when OpenCode advertises
  `loadSession`.
- Architecture #1 — provide a default `flatten_tool_result_content`.
- Architecture #3 — fix the `reserve_local_port` TOCTOU.
- Architecture #4 — race the prompt timeout against cancellation.
