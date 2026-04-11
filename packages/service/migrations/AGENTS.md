# AGENTS.md

These rules apply to SQL migrations in `packages/service/migrations/`.

- Schema migrations are managed by `sqlx` and embedded at compile time via `sqlx::migrate!()`.
- New migrations use timestamp-based names: `YYYYMMDDHHMMSS_description.sql`.
- Migrations are plain `.sql` files and are non-reversible.
