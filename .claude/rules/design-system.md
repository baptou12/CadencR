---
paths:
  - "packages/tauri/**"
---

`DESIGN.md` is the source of truth for Cadencr Desktop visual design: tokens, themes, typography, layout states, component anatomy, iconography, and UI self-audit checks.

- Before changing frontend UI, layout, styling, design tokens, icons, or user-facing visual behavior under `packages/tauri/`, read `DESIGN.md` and preserve its constraints.
- Do not load or summarize `DESIGN.md` for non-visual changes under `packages/tauri/`.
- If implementation and `DESIGN.md` conflict, pause and surface the mismatch instead of silently inventing a new visual rule.
