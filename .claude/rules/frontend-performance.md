---
paths:
  - "packages/desktop/src/**"
---

This is an IDE; users expect IDE-level responsiveness. Treat a perf regression on a hot path (agent stream, terminal, editor, long lists) as a correctness bug.

- **Always select from Zustand stores.** `useFooStore()` with no selector subscribes the consumer to every mutation, on every session. Select the slice you read — `useFooStore((s) => s.fieldA)` — and reach for `useFooStore.getState()` for actions that shouldn't drive renders.
- **Stabilize hook return values.** A hook that returns a fresh object literal each render breaks every downstream `useMemo` and `React.memo`. Wrap the return in `useMemo`, or split state and actions into separate hooks.
- **`React.memo` hot-path components** and keep their props stable (`useCallback` for callbacks, `useMemo` for objects/arrays). Anything mounted next to a streaming source or kept alive in a hidden tab qualifies.
- **Virtualize any list whose size scales with user data** — chat, logs, file trees, diff lists — with `react-virtuoso` or `@tanstack/react-virtual`.
- **Bound main-thread work.** Cache, gate by viewport, or offload synchronous parsing, highlighting, and markdown rendering at mount. Code-split heavy modules (CodeMirror, grammars, decoders) behind dynamic `import()` or `React.lazy`.
- **Gate layout reads** (`scrollHeight`, `getBoundingClientRect`) — never on every render or every resize event.

Before adding a tab, panel, or component under the agent/editor/terminal area, check how often it re-renders during streaming.
