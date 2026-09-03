//! The Steward grant: the per-feature opt-in that lets one feature's sessions
//! write to every project through the `cadencr-workspace` tools.
//!
//! Off by default. The user turns it on per feature in the feature settings
//! popover ("Workspace writes (Steward)"), which writes the key below into
//! `feature_settings` via `PUT /api/features/{id}/settings`.

use axum::http::StatusCode;
use sqlx::SqlitePool;

use crate::error::AppError;

pub(super) const STEWARD_SETTING_KEY: &str = "steward_workspace_writes";

/// Refusal code every workspace write returns when the source feature lacks the
/// grant. Stable so an agent can branch on it instead of parsing prose.
pub(super) const STEWARD_REQUIRED: &str = "STEWARD_REQUIRED";

const STEWARD_REQUIRED_MESSAGE: &str = "This feature is not granted workspace write authority. The user can enable 'Workspace writes (Steward)' in this feature's settings.";

/// Authorize a workspace-scoped write by the SOURCE feature — the one the
/// calling session belongs to, resolved server-side from its session id.
///
/// The flag is read feature-scoped, straight from `feature_settings`. Reading it
/// through `domain::settings::resolve_setting` would cascade to the project and
/// then the workspace settings file, so a single workspace-level copy of the key
/// would silently hand every feature in every project workspace write authority.
pub(super) async fn ensure_workspace_write_authority(
    pool: &SqlitePool,
    source_feature_id: i64,
) -> Result<(), AppError> {
    let authorized = crate::domain::git::repository::get_feature_setting(
        pool,
        source_feature_id,
        STEWARD_SETTING_KEY,
    )
    .await?
    .as_deref()
        == Some("true");
    if authorized {
        return Ok(());
    }
    Err(AppError::coded(
        StatusCode::FORBIDDEN,
        STEWARD_REQUIRED,
        STEWARD_REQUIRED_MESSAGE,
    ))
}

#[cfg(test)]
mod tests {
    use super::{ensure_workspace_write_authority, STEWARD_SETTING_KEY};
    use crate::error::AppError;

    async fn pool_with_grant(value: Option<&str>) -> sqlx::SqlitePool {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::shared::migrate::run_migrations(
            &crate::shared::migrate::MigrationContext::pool_only(&pool),
        )
        .await
        .unwrap();
        sqlx::query("INSERT INTO projects (id, name, path) VALUES (7, 'Proj', '/tmp/proj');")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO features (id, project_id, title, status, type)
             VALUES (42, 7, 'Source', 'active', 'ws-session')",
        )
        .execute(&pool)
        .await
        .unwrap();
        if let Some(value) = value {
            sqlx::query("INSERT INTO feature_settings (feature_id, key, value) VALUES (42, ?, ?)")
                .bind(STEWARD_SETTING_KEY)
                .bind(value)
                .execute(&pool)
                .await
                .unwrap();
        }
        pool
    }

    #[tokio::test]
    async fn only_an_exact_true_grants_workspace_write_authority() {
        ensure_workspace_write_authority(&pool_with_grant(Some("true")).await, 42)
            .await
            .expect("an explicit true grants authority");

        for refused in [None, Some("false"), Some("True"), Some("1"), Some("")] {
            let error = ensure_workspace_write_authority(&pool_with_grant(refused).await, 42)
                .await
                .unwrap_err();
            assert!(
                matches!(
                    error,
                    AppError::Coded {
                        code: "STEWARD_REQUIRED",
                        ..
                    }
                ),
                "{refused:?} must be refused"
            );
        }
    }

    /// A feature that does not exist has no grant, so it must be refused rather
    /// than error out as a missing row.
    #[tokio::test]
    async fn an_unknown_source_feature_is_refused_not_crashed() {
        let error = ensure_workspace_write_authority(&pool_with_grant(Some("true")).await, 4242)
            .await
            .unwrap_err();

        assert!(matches!(
            error,
            AppError::Coded {
                code: "STEWARD_REQUIRED",
                ..
            }
        ));
    }
}
