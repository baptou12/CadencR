---
paths:
  - "packages/service/src/shared/db.rs"
  - "packages/service/src/shared/migrate.rs"
  - "packages/service/migrations/**"
---

Migrations live in `packages/service/migrations/`, named `YYYYMMDDHHMMSS_description.sql`. They are plain, non-reversible `.sql` (no `.up`/`.down`), embedded via `sqlx::migrate!()` and run on server startup — so a released migration can never be edited, only followed by another one. For destructive changes, schema rebuilds, FK edits, or data cleanup, use the `migration-safety` skill.
