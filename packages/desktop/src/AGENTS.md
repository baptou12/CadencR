<!-- auto-generated from .claude/rules/ — edit those files and run pnpm build:agents-md -->

# AGENTS.md

These rules apply to frontend source under `packages/desktop/src/`.

### explicit-state
_Applies to: `**/*.tsx`, `**/*.ts`_

Every async operation needs visible loading state — a loader, skeleton, or progress indicator. An unacknowledged wait reads as a frozen app.

### frontend-performance
_Applies to: `packages/desktop/src/**`_

This is an IDE; users expect IDE-level responsiveness. Treat a perf regression on a hot path (agent stream, terminal, editor, long lists) as a correctness bug.

- **Always select from Zustand stores.** `useFooStore()` with no selector subscribes the consumer to every mutation, on every session. Select the slice you read — `useFooStore((s) => s.fieldA)` — and reach for `useFooStore.getState()` for actions that shouldn't drive renders.
- **Stabilize hook return values.** A hook that returns a fresh object literal each render breaks every downstream `useMemo` and `React.memo`. Wrap the return in `useMemo`, or split state and actions into separate hooks.
- **`React.memo` hot-path components** and keep their props stable (`useCallback` for callbacks, `useMemo` for objects/arrays). Anything mounted next to a streaming source or kept alive in a hidden tab qualifies.
- **Virtualize any list whose size scales with user data** — chat, logs, file trees, diff lists — with `react-virtuoso` or `@tanstack/react-virtual`.
- **Bound main-thread work.** Cache, gate by viewport, or offload synchronous parsing, highlighting, and markdown rendering at mount. Code-split heavy modules (CodeMirror, grammars, decoders) behind dynamic `import()` or `React.lazy`.
- **Gate layout reads** (`scrollHeight`, `getBoundingClientRect`) — never on every render or every resize event.

Before adding a tab, panel, or component under the agent/editor/terminal area, check how often it re-renders during streaming.

### keyboard-shortcuts
_Applies to: `**/*.tsx`_

Power users drive this app from the keyboard, so a feature that can only be triggered by mouse is incomplete if a binding would make sense. When adding one, use the `keyboard-shortcuts` skill — the registry pipeline has non-QWERTY (`e.code` vs `e.key`) and help-modal requirements that are easy to get wrong.

### no-optimistic-updates
_Applies to: `packages/desktop/src/**`_

No optimistic updates. Everything runs locally — there is no latency to hide, and optimism creates a second source of truth. Zustand state changes only when the backend confirms via a WebSocket event; never set status inside an action dispatcher (`startPlan()`, `approvePlan()`, …).

Session/agent status has exactly one source: `useSessionStatusStore` (`@/stores/session-status-store`), populated only by `session_status.update` / `session_status.snapshot` (`LiveAgentStatus`: `"idle" | "agent" | "question"`). Read "is the agent working?" from there — never re-derive or track it separately.

### provider-boundaries
_Applies to: `packages/service/src/**`, `packages/desktop/src/**`, `packages/*-sdk-rs/src/**`_

Cadencr is provider-neutral by design — don't scatter provider-specific logic across shared codepaths.

- `packages/*-sdk-rs/` crates carry transport and protocol details only.
- Provider-specific business logic belongs in that provider's backend adapter directory (`packages/service/src/domain/agents/<provider>/`, e.g. `claude_code/`, `codex/`, `cursor/`, `opencode/`). `packages/service/src/domain/agents/providers/` holds the shared registry and provider-neutral resolution, not per-provider behavior.
- Shared backend runtime, workflow, and API code consumes the unified adapter interface and provider-neutral types.
- Shared frontend components, hooks, and stores consume provider-neutral catalog/config data — no hardcoded provider branches.
- Built-in providers are registered at runtime through `providers/registry.rs`; shared code resolves adapters via `provider_registry()` / `runtime_adapter()` and must not re-derive a provider list.
- Installed ACP providers (`providers/installed/`) are data, not code: one `GenericAcpAdapter` parameterized by a descriptor. Nothing there may branch on a provider id, and a descriptor may not declare capabilities the ACP handshake owns (models, modes, permission maps, auth) — those come from `initialize` / `session/new`.

When a provider needs special handling, extract it into a dedicated provider file or folder rather than adding another conditional to generic code.

### strict-typing
_Applies to: `**/*.ts`, `**/*.tsx`_

Never use `any` — use `unknown` and narrow with type guards, and validate external boundaries with Zod. (`typescript/no-explicit-any` is a hard oxlint error, so this fails the build, not just review.)
