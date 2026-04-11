# AGENTS.md

These rules apply to `packages/service/src/shared/`.

- Database schema migrations are managed by `sqlx` in `packages/service/migrations/`.
- When changing migration orchestration in `db.rs` or `migrate.rs`, keep it aligned with `sqlx::migrate!()`.
- New migrations use timestamp-based names: `YYYYMMDDHHMMSS_description.sql`.
- Migrations are plain `.sql` files and are non-reversible.
