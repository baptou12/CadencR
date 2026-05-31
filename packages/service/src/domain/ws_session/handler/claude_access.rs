use sqlx::SqlitePool;

use crate::domain::settings;

const BYPASS_PERMISSIONS_KEY: &str = "claude_bypass_permissions_enabled";
const FALSE: &str = "false";
const TRUE: &str = "true";

pub(super) async fn bypass_permissions_enabled(
    read_pool: &SqlitePool,
    feature_id: Option<i64>,
    project_id: Option<i64>,
) -> bool {
    let resolved_project_id = match (project_id, feature_id) {
        (Some(project_id), _) => Some(project_id),
        (None, Some(feature_id)) => project_id_for_feature(read_pool, feature_id).await,
        (None, None) => None,
    };

    settings::resolve_setting(
        read_pool,
        BYPASS_PERMISSIONS_KEY,
        feature_id,
        resolved_project_id,
        Some(FALSE),
    )
    .await
    .unwrap_or_else(|| FALSE.to_string())
        == TRUE
}

async fn project_id_for_feature(read_pool: &SqlitePool, feature_id: i64) -> Option<i64> {
    sqlx::query_scalar::<_, Option<i64>>("SELECT project_id FROM features WHERE id = ? LIMIT 1")
        .bind(feature_id)
        .fetch_optional(read_pool)
        .await
        .ok()
        .flatten()
        .flatten()
}
