# AGENTS.md

These rules apply to frontend source under `packages/tauri/src/`.

- Do not use optimistic updates in the frontend. The Zustand store is the single source of truth, and state should update only after backend confirmation via WebSocket events.
- Every async operation must show visible loading, progress, or skeleton state.
- When adding a new user-facing feature in `.tsx`, ask whether it should also have a keyboard shortcut.
- Keep TypeScript explicit. Do not introduce `any`.
- All functions, parameters, and return values must have explicit types. Use `unknown` plus narrowing when needed.
- Frontend errors must be user-visible. Show a toast or inline error state instead of logging-only or swallowing failures.
- Performance is a hard constraint, not an afterthought. The app is an IDE; technical users expect IDE-level responsiveness. Think about render cost, subscription scope, and main-thread work _before_ writing the change.

## Frontend performance rules

Mandatory practices:

- **Always select from Zustand stores.** Never call a store hook without a selector (`useFooStore()` subscribes the consumer to every mutation). Always select the slice you actually read: `useFooStore((s) => s.fieldA)`. Read actions outside the render flow via `useFooStore.getState()` when they don't need to drive UI updates.
- **Stabilize hook return values.** A custom hook that returns a fresh object literal each render breaks every downstream `useMemo` and `React.memo`. Wrap the return in `useMemo` keyed on the primitive fields it depends on, or split state and actions into separate hooks.
- **`React.memo` hot-path components.** Anything mounted next to a streaming source (agent stream, terminal, editor, long list) or kept alive in a hidden tab must be memoized. Verify props are stable — callbacks via `useCallback`, objects/arrays via `useMemo`.
- **Virtualize long lists.** Rendering hundreds of DOM nodes for a chat, log, file tree, or diff list is a bug. Use `react-virtuoso` or `@tanstack/react-virtual`.
- **Bound main-thread work.** Synchronous parsing, syntax highlighting, or markdown rendering at mount must be cached, gated by viewport, or offloaded (`requestIdleCallback`, Web Worker). No unbounded synchronous work on first paint.
- **Lazy-load heavy modules.** Editors (CodeMirror), syntax-highlighting grammars, and any module > 100 KB gzipped must be code-split via dynamic `import()` or `React.lazy`.

Forbidden patterns:

- Subscribing a hot component to an entire store (no selector), or returning the raw store from a wrapper hook.
- Returning a fresh object literal from a custom hook without `useMemo`.
- Passing freshly-built objects, arrays, or arrow functions as props through a streaming or list-rendering parent.
- Adding a new tab, panel, or component under the agent/editor/terminal area without auditing how often it re-renders during streaming.
- Running heavy computation inside the render body. Move it to `useMemo`, an effect, or off-thread.
- Triggering layout reads (`scrollHeight`, `getBoundingClientRect`, etc.) on every render or every resize event without gating.

When in doubt, profile first. A perf regression on a hot path is treated like a correctness bug.
