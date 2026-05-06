---
paths:
  - "packages/desktop/src/**"
---

Do NOT use optimistic updates in the frontend. Everything runs locally — there is no latency to hide. Optimistic updates create multiple sources of truth and add unnecessary complexity.

The Zustand store state must be the single source of truth. Only update store state when the backend confirms a change via WebSocket events. Never set state optimistically in action dispatchers (e.g., don't set `workflowStatus` in `startPlan()`, `approvePlan()`, etc. — wait for the `status_changed` WebSocket event from the backend).
