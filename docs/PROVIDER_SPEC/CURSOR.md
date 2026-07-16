# Provider status — Cursor

Status of the Cursor adapter against [`FEATURES.md`](./FEATURES.md).

The adapter lives in `packages/service/src/domain/agents/cursor/` and starts
the official Cursor Agent CLI as `agent acp`. Cursor ACP uses newline-delimited
JSON-RPC 2.0 over stdio. Standard ACP traffic is handled by the shared
`packages/service/src/domain/agents/acp/runtime/` layer; Cursor authentication,
tool normalization, disk MCP configuration, model discovery, and `cursor/*`
extension methods remain inside the Cursor adapter.

The CLI binary/discovery boundary lives in
`packages/cursor-agent-sdk-rs/`. Install and authenticate it with:

```bash
curl https://cursor.com/install -fsS | bash
agent login
```

## Status matrix

| #   | Feature                                  | Status | Notes                                                                                                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Modes: default / plan / ask              | ✅     | Cadencr `Default` maps to Cursor ACP `agent`; `Plan` maps to `plan`; `Ask` maps to `ask`. `AcceptEdits` and Cursor CLI Debug are not exposed by Cursor ACP.                                                                                                                                                                           |
| 2   | Thinking                                 | ✅     | Standard ACP `agent_thought_chunk` updates map to dedicated runtime thinking deltas.                                                                                                                                                                                                                                                  |
| 3   | Partial / streaming messages             | ✅     | Shared ACP message/block indexer maps message, thought, tool-call, and completion updates.                                                                                                                                                                                                                                            |
| 4   | Bash tool calls + outputs                | ✅     | Cursor `shell` / `terminal` / `shellToolCall` normalize to `Bash`; ACP terminal requests run through the sandboxed terminal registry.                                                                                                                                                                                                 |
| 5   | Edits / Writes / Patch                   | ✅     | Cursor names normalize to `Write`, `Edit`, and `ApplyPatch`; `path`, `fileText`, `oldText`, and `newText` normalize to Cadencr's canonical input keys.                                                                                                                                                                                |
| 6   | Sub-agents                               | 🟡     | Composer's `Task: Subagent task` call renders immediately as a canonical `Agent` block; `cursor/task` completion metadata enriches that same block with prompt/type/model/agent details. Cursor does not expose a live child event stream or final child text in this extension.                                                      |
| 7   | Todo                                     | ✅     | `cursor/update_todos` maps to `TodoWrite`; stable `toolCallId`s are retained and statuses normalize to the canonical runtime shape.                                                                                                                                                                                                   |
| 8   | Thinking level changes                   | 🟡     | Cadencr advertises `clientCapabilities._meta.parameterizedModelPicker`, which unlocks Cursor's separate `fast` / thought-level (`effort` / `reasoning`) config options. Cold catalog still lists variant model ids; the adapter maps those onto base model + companion config updates. Live effort chips remain catalog-gated (`supports_effort: false`) until per-model levels are published. |
| 9   | Model selection changes                  | ✅     | Account-scoped models come from `agent models`; changes use the opaque select values advertised by live `session/new` / `session/load` config options. Cursor's `composer-2.5-fast` catalog id maps to the advertised `composer-2.5[fast=true]` value.                                                                                  |
| 10  | Permissions: yes / no / always / session | ✅     | Standard `session/request_permission` options map through the shared bridge. The independent access-mode axis supports Default, Full Access, and Auto Review through Cursor's official CLI flags. `cursor/ask_question` is bridged to Cadencr's question drawer; Composer may still omit emitting it for a given turn.               |
| 11  | MCP                                      | 🟡     | Runtime MCP servers are passed through ACP and merged into `.cursor/mcp.json` without replacing user servers. Status remains `unknown`; team-dashboard MCP and hot swap are not available.                                                                                                                                            |
| 12  | Plan approval                            | ✅     | `cursor/create_plan` synthesizes `ExitPlanMode`, opens Cadencr's plan gate, returns Cursor's accepted/rejected response schema, waits for the planning turn to end, then sends Cursor the execution follow-up in `agent` mode.                                                                                                                                                                       |
| 13  | Context usage                            | ❌     | Cursor ACP does not currently expose authoritative per-turn token occupancy/context-window data; the adapter deliberately does not guess.                                                                                                                                                                                             |
| 14  | Compaction                               | ✅     | Cadencr's `/compact` command invokes the live runtime compaction path, which sends Cursor's `/compress` prompt and emits a manual compact boundary on success. Typing `/compress` directly is an ordinary agent prompt, not Cadencr's compaction command.                                                                             |
| 15  | Command + skill list                     | 🟡     | Live ACP `available_commands_update` catalogs are cached per CWD and merged with Cadencr commands/skills. There is no separate cold Cursor command probe before the first live session.                                                                                                                                               |
| 16  | Replay / send-target detection           | ✅     | Follow-ups reuse the live ACP `sessionId`; restart resume uses `session/load` when Cursor advertises `loadSession`.                                                                                                                                                                                                                   |

Legend: ✅ implemented · 🟡 partial · ❌ missing.

## Cursor-specific ACP extensions

| Method                  | Direction        | Cadencr projection                                                                                |
| ----------------------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| `cursor/ask_question`   | Blocking request | `AskUserQuestion` tool + question drawer; response becomes `answered`, `skipped`, or `cancelled` (explicit cancel feedback). Free-text / Other answers are preserved. |
| `cursor/create_plan`    | Blocking request | `ExitPlanMode` tool + `PlanApproval` permission gate.                                             |
| `cursor/update_todos`   | Non-blocking request or notification | `TodoWrite` tool with normalized statuses; requests receive an empty success response.              |
| `cursor/task`           | Non-blocking request or notification | `Agent` tool containing sub-agent metadata; requests receive an empty success response.             |
| `cursor/generate_image` | Non-blocking request or notification | `GenerateImage` tool preserving the raw Cursor payload; requests receive an empty success response. |

All method-name checks and response-shape translations live under
`domain/agents/cursor/acp/`; the shared ACP event loop calls only
`AcpProviderHooks` extension points.

## Standard ACP tool metadata

Cursor's documented ACP transport uses standard `tool_call` and
`tool_call_update` session notifications alongside the `cursor/*` extensions.
The [ACP tool-call contract](https://agentclientprotocol.com/protocol/v1/tool-calls)
makes `title` the required human-readable description, while `locations`
carries the relevant file paths. `rawInput` is optional.

The provider-neutral ACP runtime therefore projects every tool call into one
canonical input object:

- Explicit `rawInput` / `toolInput` fields remain authoritative.
- ACP `title` fills `description` only when the input does not already provide
  one.
- The complete `locations` array is retained. Its first entry also fills
  `path` and `line` when no explicit file path is present.
- Metadata arriving in later `tool_call_update` notifications merges with the
  existing input instead of replacing descriptions or paths.
- Diff content still synthesizes canonical `Write` / `Edit` input when Cursor
  omits raw arguments.

Current Cursor Composer sessions omit both `rawInput` and `locations` for
native Read and Search calls (the observed starts are only `title: "Read File"`
or `title: "grep"` plus their coarse kind). Cadencr therefore shows the title
as the best available description, but cannot truthfully reconstruct the read
path or search query from ACP. Edit/Write diff calls, Bash terminal calls,
sub-agent metadata, and generated-image calls do expose their relevant paths
or arguments and render them normally.

Standard ACP kinds normalize to `Read`, `Edit`, `Delete`, `Move`, `Search`,
`Bash`, `Think`, `Fetch`, and `SwitchMode`. Cursor-specific aliases such as
`shell`, `grep`, `rename_file`, and `generate_image` normalize inside the
Cursor adapter. The desktop parser renders the most relevant argument for each
canonical kind and falls back to the ACP description for unknown tools.

## Catalog and discovery

- Binary name: `agent` (the current primary name; `cursor-agent` is an upstream
  compatibility alias).
- Default install path: `~/.local/bin/agent`.
- Override setting: `cursor_cli_path`.
- Static fallback model: `auto`.
- Live catalog: `agent models`, parsed as `<id> - <label> (current)` and cached
  for 30 seconds.
- A missing binary marks Cursor unavailable. A model probe/authentication error
  keeps Cursor available with the safe `auto` fallback and an actionable
  `agent login` status message.

## Modes and plan approval

| Cadencr mode        | Cursor mode                                                |
| ------------------- | ---------------------------------------------------------- |
| `Default`           | `agent`                                                    |
| `AcceptEdits`       | Unsupported; Cursor has no distinct equivalent             |
| `Plan`              | `plan`                                                     |
| `Ask`               | `ask`                                                      |
| `Auto`              | Unsupported in the Cursor UI catalog                       |
| `BypassPermissions` | Unsupported; no unsafe approximation                       |
| `DontAsk`           | Unsupported; no equivalent with identical safety semantics |

Cursor Agent `2026.07.09-a3815c0` advertises only `agent`, `plan`, and `ask`
from ACP `session/new`. Its interactive `/debug` mode is not accepted by
`session/set_mode`, so Cadencr does not advertise a non-functional Debug mode.

When Cursor sends `cursor/create_plan`, the adapter records the request id as
`RuntimePermissionResponseKind::PlanApproval`. Shared orchestration changes the
live session from `plan` to `agent` before the adapter returns Cursor's native
`{ "outcome": { "outcome": "accepted" } }` response.

## Access and approval modes

Cursor's collaboration mode (`agent` / `plan`) is independent from its
approval/execution mode. Cadencr keeps those as two adapter inputs instead of
folding unsafe execution into `RuntimePermissionMode`:

| Cadencr access mode | Cursor CLI launch                           | Cursor behavior                                                                                                                                                                                       |
| ------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Default`           | `agent --sandbox enabled acp`               | Sandboxed execution with Cursor's configured approval rules (normally `approvalMode: allowlist`).                                                                                                     |
| `FullAccess`        | `agent --force --sandbox disabled acp`      | `approvalMode: unrestricted`; Run Everything with the sandbox disabled unless explicitly denied.                                                                                                      |
| `AutoReview`        | `agent --auto-review --sandbox enabled acp` | Sandboxed execution. Until Cursor ACP honors the flag, the adapter preflights ordinary shell allowlist misses after Cursor's parser and safety-policy checks; MCP/non-shell gates remain interactive. |

Cursor ACP currently advertises only `mode` and `model` as session config
options, so approval mode cannot be changed through
`session/set_config_option`. The adapter therefore owns the launch-flag
mapping. Changing access mode on a live conversation records the desired mode;
the shared runtime resumes the Cursor session with the new flag before the next
prompt. The workspace default is stored under `cursor_access_mode`.

Cursor Agent `2026.07.09-a3815c0` parses `--auto-review`, but its ACP session
bootstrap only persists the `--force` path and otherwise leaves the session in
`allowlist` mode. That makes stock ACP request approval even for `pwd`. The
Cursor adapter therefore answers `allow_once` when Cursor reports only a plain
shell allowlist miss. Cursor's parser, sandbox, blocklist, delete-protection,
hook, and team-policy checks run before that request; any request carrying one
of those stronger reasons remains interactive. MCP and other non-shell gates
also remain interactive because ACP does not expose the classifier result for
them. This fallback stays inside the Cursor adapter and can be removed once the
upstream ACP bootstrap honors Auto Review.

## MCP behavior

Cursor's ACP documentation requires MCP servers to exist in user/project
`.cursor/mcp.json`. Before spawn, the adapter merges Cadencr's runtime stdio
servers into the project file:

- Existing top-level fields and user-owned servers are preserved.
- Cadencr entries win only on the same server name.
- Invalid JSON is a visible spawn error; it is never silently replaced.
- The same servers are also sent in ACP `session/new` / `session/load` for
  forward compatibility.

## Known upstream/contract limitations

1. Cursor's ACP model/config surface has changed across CLI releases. The
   adapter relies on the current `model` config id and falls back safely when
   `session/set_config_option` is unavailable.
2. Cursor exposes no authoritative context occupancy in the documented ACP
   surface, so Cadencr's context percentage remains unavailable.
3. `cursor/task` is completion metadata, not a child-session stream. Nested
   live sub-agent rendering cannot be reconstructed without more upstream
   events.
4. Cadencr advertises `parameterizedModelPicker` so Cursor exposes clean model
   ids plus `fast` / thought-level companions. Cold `agent models` catalog ids
   still encode variants (`*-fast`, `*-high`); the adapter decomposes those into
   base model + companion `session/set_config_option` updates. A first-class
   Cadencr effort chip still waits on per-model `supports_effort` catalog data.
5. The `cursor/ask_question` bridge is implemented. Composer may simply not emit
   the extension for a given turn; a prompt cannot force an unavailable tool.
6. Read/Search starts currently omit ACP `locations` and raw arguments, so the
   required title is the only trustworthy tool description available.
