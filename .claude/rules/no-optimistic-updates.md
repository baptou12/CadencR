---
paths:
  - "packages/desktop/src/**"
---

No optimistic updates. Everything runs locally — there is no latency to hide, and optimism creates a second source of truth. Zustand state changes only when the backend confirms via a WebSocket event; never set status inside an action dispatcher (`startPlan()`, `approvePlan()`, …).

Session/agent status has exactly one source: `useSessionStatusStore` (`@/stores/session-status-store`), populated only by `session_status.update` / `session_status.snapshot` (`LiveAgentStatus`: `"idle" | "agent" | "question"`). Read "is the agent working?" from there — never re-derive or track it separately.
