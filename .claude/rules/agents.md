---
paths:
  - "packages/electron/src/main/agents/**"
---

All agent types must go through `unified-agent.ts` — never spawn agents directly. All IPC events flow through `ipc-bridge.ts` — never send IPC directly from agent files.
