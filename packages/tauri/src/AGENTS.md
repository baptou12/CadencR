# AGENTS.md

These rules apply to frontend source under `packages/tauri/src/`.

- Do not use optimistic updates in the frontend. The Zustand store is the single source of truth, and state should update only after backend confirmation via WebSocket events.
- Every async operation must show visible loading, progress, or skeleton state.
- When adding a new user-facing feature in `.tsx`, ask whether it should also have a keyboard shortcut.
- Keep TypeScript explicit. Do not introduce `any`.
- All functions, parameters, and return values must have explicit types. Use `unknown` plus narrowing when needed.
- Frontend errors must be user-visible. Show a toast or inline error state instead of logging-only or swallowing failures.
- Performance matters. Avoid unnecessary re-renders, heavy work on the main thread, and redundant data fetching.
