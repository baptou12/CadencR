# Claude Bypass Access Chip Design

## Goal

Make Claude Code `bypassPermissions` reliable by separating the dangerous Bypass access capability from Claude's normal collaboration/permission-mode cycle, matching Codex's dedicated right-side access chip pattern.

## Problem

Claude Code exposes two distinct concepts that Cadencr currently models as one linear cycle:

| Concept | Current Cadencr Representation | Required Representation |
| --- | --- | --- |
| Normal workflow mode | `acceptEdits`, `plan`, `auto`, `bypassPermissions` in one chip cycle | `acceptEdits`, `plan`, `auto` in the normal mode chip |
| Dangerous Bypass access | Opt-in item at the end of the mode cycle | Dedicated right-side access chip, like Codex |

This coupling makes Bypass unreliable because a user may need to pass through `auto` first, and `auto` can be rejected by Claude for the active model. A separate observed failure shows Claude can also reject a live switch to `bypassPermissions` when the process was not launched with the required Bypass capability flag.

## Current Behavior

- Frontend Claude mode order is `acceptEdits -> plan -> auto -> bypassPermissions`.
- `bypassPermissions` is gated by `claude_bypass_permissions_enabled` and appears in the normal mode cycle.
- Backend sends live `set_permission_mode("bypassPermissions")` for active sessions.
- Claude SDK spawn args support `--permission-mode bypassPermissions`, but not a separate launch-time capability flag.
- When the CLI rejects `auto`, frontend recovery may skip to the next visible mode using React Query cache state.

## Proposed Behavior

### UI Model

Claude Code should have two controls when Bypass is enabled in settings:

| Control | Location | Values | Meaning |
| --- | --- | --- | --- |
| Normal mode chip | Existing mode chip | `acceptEdits`, `plan`, `auto` | Current Claude workflow/autonomy mode |
| Claude access chip | Right side near Codex access chip/session info | `Default`, `Bypass` | Whether the live Claude session is currently in dangerous Bypass mode |

`bypassPermissions` must be removed from Claude's normal mode cycle. The normal mode chip should never use `auto` rejection recovery as the route to Bypass.

### Spawn Capability

When `claude_bypass_permissions_enabled=true`, any newly spawned Claude Code process should include the launch-time capability flag that allows later entry into Bypass without making Bypass active immediately.

The SDK-level flag should be modeled separately from `permission_mode` so Cadencr can spawn a session in `plan` or `acceptEdits` while still allowing a later explicit Bypass switch.

### Access Toggle Semantics

When the Claude access chip switches from `Default` to `Bypass`:

1. Frontend sends a dedicated request for `bypassPermissions`.
2. Backend calls the active runtime's `set_permission_mode(BypassPermissions)`.
3. Backend persists `permission_mode='bypassPermissions'` only after CLI acceptance.
4. Backend emits `mode.changed` or equivalent authoritative confirmation.
5. Frontend updates chip state only from backend confirmation.

When the chip switches from `Bypass` to `Default`:

1. Backend should restore the last known non-bypass Claude mode if available.
2. If no prior non-bypass mode is known, fallback to `acceptEdits`.
3. Backend persists and emits the accepted mode.

If Claude rejects `bypassPermissions`, the UI must surface the real CLI rejection and must not infer Bypass unavailability from unrelated `auto` failures.

## Data Model

Avoid adding a new database column unless implementation proves it necessary. The existing `agent_sessions.permission_mode` can continue to hold the actual active mode, including `bypassPermissions`.

For restoring the previous mode after turning Bypass off, the runtime handle can track a transient `last_non_bypass_permission_mode` value. This is enough for active-session toggles. If the session reloads while persisted in Bypass, turning Bypass off should fallback to `acceptEdits`.

## Frontend Architecture

Add Claude-specific access presentation beside the existing Codex access chip without provider-specific branches leaking into unrelated shared logic.

Suggested boundaries:

| Unit | Responsibility |
| --- | --- |
| Claude access mode definitions | Labels, descriptions, icons, chip classes for `Default` and `Bypass` |
| Claude access popover/chip | Render the right-side access chip and emit explicit target mode changes |
| `MetaBar` integration | Show Codex chip for Codex sessions and Claude chip for Claude sessions when Bypass is enabled |
| Provider mode catalog | Keep Claude normal mode cycle to `acceptEdits`, `plan`, `auto` |

Frontend updates must follow no-optimistic-updates: clicking the chip sends a request, and local state changes only after backend confirmation.

## Backend Architecture

Add an explicit backend helper for Claude Bypass capability and transition behavior while keeping provider-specific logic in provider adapter/service boundaries.

Suggested boundaries:

| Unit | Responsibility |
| --- | --- |
| Claude SDK options | Add launch capability arg for allowing dangerous skip permissions |
| Runtime spawn config | Carry provider-neutral or Claude-scoped dangerous capability information to adapter spawn |
| Claude adapter spawn | Emit the Claude CLI flag when capability is enabled |
| Session mode control | Track last non-bypass mode and handle accepted/rejected transitions consistently |

The existing `MODE_REJECTED_BY_CLI` error path remains useful for real CLI rejections. Frontend should show Bypass rejection as a user-visible error, not auto-recover it.

## Error Handling

| Failure | Behavior |
| --- | --- |
| Bypass setting disabled | Hide the Claude access chip and do not include Bypass in the normal mode cycle |
| Bypass live switch rejected | Show the CLI rejection in a toast or inline error; do not change chip state |
| Auto rejected | Recover within normal modes only; never use auto rejection as Bypass availability signal |
| Spawn capability unsupported by old Claude CLI | Surface the spawn error clearly; do not silently continue with a process that presents Bypass as switchable |

## Testing Strategy

Use test-first implementation.

| Layer | Test |
| --- | --- |
| Claude SDK | `Options::to_cli_args()` includes the allow-dangerously-skip-permissions flag only when enabled |
| Frontend provider modes | Claude visible normal cycle excludes `bypassPermissions` even when Bypass opt-in is enabled |
| Frontend access chip | Claude Bypass access chip sends explicit mode changes and shows no optimistic state before confirmation |
| Backend mode control | Switching into Bypass persists only after runtime acceptance; rejection keeps prior mode/config state |
| Backend spawn config | With `claude_bypass_permissions_enabled=true`, Claude spawn config includes the Bypass capability while normal mode can remain `plan` or `acceptEdits` |

## Keyboard Shortcut Decision

No new shortcut should be added for the dedicated Claude Bypass chip. Bypass is dangerous and should remain an explicit click/popover action, like Codex access mode. Existing `Shift+Tab` continues to cycle normal modes only.

## Out of Scope

- Redesigning Codex access behavior.
- Adding a universal provider access framework for every provider.
- Persisting a separate previous-non-bypass mode across app restarts.
- Removing Claude `auto` fallback logic from post-plan approval unless it directly conflicts with this change.
