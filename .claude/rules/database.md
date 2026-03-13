---
paths:
  - "packages/electron/src/main/db/**"
---

Use `better-sqlite3` synchronous API only — no async DB calls. New tables require a new numbered migration in `migrations.ts` following the existing pattern.
