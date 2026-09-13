use sqlx::sqlite::SqlitePoolOptions;

use super::{run_migrations, MigrationContext};

const TARGET_VERSION: i64 = 20260912090000;

#[tokio::test]
async fn migration_preserves_existing_projects_and_children_unmarked() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::raw_sql(
        "PRAGMA foreign_keys = ON; \
         CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, \
         branch_prefix TEXT, created_at TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'user'); \
         CREATE TABLE features (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL \
         REFERENCES projects(id) ON DELETE CASCADE); \
         INSERT INTO projects (id, name, path, created_at, kind) VALUES \
         (1, 'Ordinary', '/tmp/ordinary', '2026-01-01', 'user'), \
         (2, 'Legacy theme', '/tmp/theme', '2026-01-02', 'theme'); \
         INSERT INTO features (id, project_id) VALUES (10, 1), (20, 2)",
    )
    .execute(&pool)
    .await
    .unwrap();
    seed_migrations_before_target(&pool).await;

    run_migrations(&MigrationContext::pool_only(&pool))
        .await
        .unwrap();

    let projects: Vec<(i64, String, Option<String>, Option<String>)> =
        sqlx::query_as("SELECT id, kind, authoring_target, plugin_id FROM projects ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        projects,
        vec![
            (1, "user".into(), None, None),
            (2, "theme".into(), None, None)
        ]
    );
    let children: Vec<(i64, i64)> =
        sqlx::query_as("SELECT id, project_id FROM features ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(children, vec![(10, 1), (20, 2)]);
    let foreign_key_violations: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(foreign_key_violations, 0);
}

async fn seed_migrations_before_target(pool: &sqlx::SqlitePool) {
    sqlx::query(
        "CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY, description TEXT NOT NULL, \
         installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, success BOOLEAN NOT NULL, \
         checksum BLOB NOT NULL, execution_time BIGINT NOT NULL)",
    )
    .execute(pool)
    .await
    .unwrap();
    let migrator = sqlx::migrate!("./migrations");
    for migration in migrator
        .iter()
        .filter(|migration| migration.version < TARGET_VERSION)
    {
        sqlx::query("INSERT INTO _sqlx_migrations VALUES (?, ?, CURRENT_TIMESTAMP, TRUE, ?, 0)")
            .bind(migration.version)
            .bind(&*migration.description)
            .bind(&*migration.checksum)
            .execute(pool)
            .await
            .unwrap();
    }
}
