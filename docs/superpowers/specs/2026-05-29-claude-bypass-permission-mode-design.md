# Claude Bypass Permission Reliability

## Objective

Make Claude Code `bypassPermissions` reliable while matching the official Claude Code permission-mode model:

- `bypassPermissions` is a normal permission mode, not a separate access chip.
- The provider setting only unlocks the mode by launching Claude with bypass capability.
- Plan mode remains usable while bypass capability is enabled.

## Official Behavior To Mirror

Claude Code documents `bypassPermissions` as an optional mode in the same mode selector/cycle as `acceptEdits`, `plan`, and `auto`.

When enabled, optional modes slot after `plan`:

```text
acceptEdits -> plan -> bypassPermissions -> auto -> acceptEdits
```

The launch flag `--allow-dangerously-skip-permissions` adds `bypassPermissions` to the cycle without activating it. Entering `bypassPermissions` still requires selecting that mode.

## Design

| Concern | Behavior |
| --- | --- |
| Claude setting | Adds bypass capability for future Claude processes. |
| Prompt mode chip | Shows `Bypass` as an opt-in Claude permission mode when enabled. |
| Plan mode | Still selectable and runnable while bypass capability is enabled. |
| Active bypass | Only active when the current session mode is `bypassPermissions`. |
| Existing sessions | If a live Claude process lacks bypass capability, rearm the session so the next prompt resumes with capability and the requested mode. |

## Frontend Requirements

- Keep `bypassPermissions` in the Claude provider-mode catalog.
- Mark `bypassPermissions` as `optIn: true`.
- Render Bypass in the regular mode chip and `Shift+Tab` cycle.
- Do not render a dedicated Claude access chip.
- Keep Codex access mode as a separate chip because Codex sandbox/access mode is not the same concept as its collaboration mode.

## Backend Requirements

- When `claude_bypass_permissions_enabled=true`, spawn Claude Code with `--allow-dangerously-skip-permissions`.
- Do not force the initial permission mode to `bypassPermissions`.
- Preserve the selected permission mode in `RuntimeSpawnConfig`.
- For already-running Claude sessions without bypass capability, switching to `bypassPermissions` should rearm the runtime handle for the next prompt instead of accepting stale UI state.

## Test Coverage

| Area | Assertion |
| --- | --- |
| Provider catalog | Claude modes include `acceptEdits`, `plan`, opt-in `bypassPermissions`, then `auto`. |
| Visible modes | Bypass appears only when the setting enables the opt-in mode. |
| Mode cycle | With bypass enabled, `plan` cycles to `bypassPermissions` and then `auto`. |
| Meta bar | Claude Bypass renders as the regular permission mode chip with the `Shift+Tab` shortcut. |
| SDK args | Claude SDK emits `--allow-dangerously-skip-permissions` when capability is enabled. |
| Backend session init | Enabling capability does not activate bypass unless requested. |
| Existing session switch | Bypass request rearms a Claude session that was spawned without capability. |

