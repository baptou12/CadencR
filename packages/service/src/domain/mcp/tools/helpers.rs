use std::future::Future;

use rmcp::model::{CallToolResult, Content};
use sqlx::SqlitePool;

/// Extract a required i64 parameter from JSON args, returning a clear error if missing.
pub fn require_i64(args: &serde_json::Value, key: &str) -> Result<i64, String> {
    args[key]
        .as_i64()
        .ok_or_else(|| format!("Missing required parameter: {key}"))
}

/// Returns the subprocess-pinned feature id after confirming it matches any
/// `feature_id` the tool's arguments supply — blocks confused-deputy
/// cross-feature attacks.
pub fn pinned_feature_id(args: &serde_json::Value, pinned: i64) -> Result<i64, String> {
    if let Some(arg_fid) = args.get("feature_id").and_then(|v| v.as_i64()) {
        if arg_fid != pinned {
            return Err(format!(
                "feature_id mismatch: subprocess is pinned to {pinned}, but tool call \
                 supplied {arg_fid}"
            ));
        }
    }
    Ok(pinned)
}

/// Extract a required string parameter from JSON args, returning a clear error if missing.
pub fn require_str<'a>(args: &'a serde_json::Value, key: &str) -> Result<&'a str, String> {
    args[key]
        .as_str()
        .ok_or_else(|| format!("Missing required parameter: {key}"))
}

/// Wraps text in a successful tool result
pub fn text_result(text: &str) -> CallToolResult {
    CallToolResult::success(vec![Content::text(text)])
}

/// Wraps error message in an error tool result
pub fn error_result(msg: &str) -> CallToolResult {
    CallToolResult::error(vec![Content::text(msg)])
}

pub async fn dispatch_tool<Fut>(dispatch: Fut) -> CallToolResult
where
    Fut: Future<Output = Result<String, String>>,
{
    match dispatch.await {
        Ok(text) => text_result(&text),
        Err(e) => error_result(&e),
    }
}

/// Look up or create the plan for a feature.
/// If a plan already exists, returns its ID. Otherwise creates one.
/// Safe under concurrency: SQLite serializes writes, so the INSERT
/// can only race with another INSERT on the same write pool.
pub async fn get_or_create_plan_id(pool: &SqlitePool, feature_id: i64) -> Result<i64, String> {
    if let Ok(id) = sqlx::query_scalar::<_, i64>(
        "SELECT id FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1",
    )
    .bind(feature_id)
    .fetch_one(pool)
    .await
    {
        return Ok(id);
    }

    sqlx::query_scalar::<_, i64>(
        "INSERT INTO plans (feature_id, title, status) VALUES (?, 'Untitled Plan', 'draft') RETURNING id",
    )
    .bind(feature_id)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to create plan for feature {feature_id}: {e}"))
}

/// Get plan_id from args or resolve it from feature_id. If the agent passes plan_id,
/// use it (with ownership check). If omitted, look up (or create) the feature's plan.
pub async fn get_or_resolve_plan_id(
    args: &serde_json::Value,
    pool: &SqlitePool,
    feature_id: i64,
) -> Result<i64, String> {
    // Models (especially via OpenAI-style strict JSON schemas) sometimes fill
    // optional integer fields with the sentinel `0` instead of omitting them.
    // Plan IDs are AUTOINCREMENT in SQLite and always start at 1, so `0` and
    // negative values can never be valid — treat them as "not specified" and
    // fall through to the feature-linked default, matching the behavior the
    // tool description promises.
    match args["plan_id"].as_i64() {
        Some(plan_id) if plan_id > 0 => {
            verify_plan_ownership(pool, plan_id, feature_id).await?;
            Ok(plan_id)
        }
        _ => get_or_create_plan_id(pool, feature_id).await,
    }
}

/// Verify that a plan belongs to the given feature_id.
pub async fn verify_plan_ownership(
    pool: &SqlitePool,
    plan_id: i64,
    feature_id: i64,
) -> Result<(), String> {
    let actual: i64 = sqlx::query_scalar("SELECT feature_id FROM plans WHERE id = ?")
        .bind(plan_id)
        .fetch_one(pool)
        .await
        .map_err(|_| format!("Plan {plan_id} not found"))?;

    if actual != feature_id {
        return Err(format!("Plan {plan_id} does not belong to this feature"));
    }
    Ok(())
}

/// Verify that a phase belongs to the given feature_id (via its plan).
pub async fn verify_phase_ownership(
    pool: &SqlitePool,
    phase_id: i64,
    feature_id: i64,
) -> Result<(), String> {
    let actual: i64 = sqlx::query_scalar(
        "SELECT p.feature_id FROM phases ph JOIN plans p ON ph.plan_id = p.id WHERE ph.id = ?",
    )
    .bind(phase_id)
    .fetch_one(pool)
    .await
    .map_err(|_| format!("Phase {phase_id} not found"))?;

    if actual != feature_id {
        return Err(format!("Phase {phase_id} does not belong to this feature"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{get_or_resolve_plan_id, pinned_feature_id};
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn pinned_feature_id_returns_pin_when_args_empty() {
        assert_eq!(pinned_feature_id(&json!({}), 42).unwrap(), 42);
    }

    #[tokio::test]
    async fn pinned_feature_id_allows_matching_arg() {
        assert_eq!(
            pinned_feature_id(&json!({ "feature_id": 7 }), 7).unwrap(),
            7
        );
    }

    #[tokio::test]
    async fn pinned_feature_id_rejects_mismatched_arg() {
        // Defense in depth: a prompt-injected agent that tries to switch
        // features via the tool-call argument gets an explicit error.
        let err = pinned_feature_id(&json!({ "feature_id": 99 }), 7).unwrap_err();
        assert!(err.contains("mismatch"), "got: {err}");
    }

    async fn pool_with_plans_schema() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE plans (id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NOT NULL, title TEXT, status TEXT)",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn plan_id_zero_falls_through_to_auto_resolve() {
        let pool = pool_with_plans_schema().await;
        // No plan row yet — auto-resolve should create one for feature 42.
        let resolved = get_or_resolve_plan_id(&json!({ "plan_id": 0 }), &pool, 42)
            .await
            .expect("0 should be treated as unset and auto-resolve");
        assert!(resolved > 0);

        // Calling again with null should return the same plan.
        let resolved_again = get_or_resolve_plan_id(&json!({ "plan_id": null }), &pool, 42)
            .await
            .unwrap();
        assert_eq!(resolved, resolved_again);
    }

    #[tokio::test]
    async fn explicit_positive_plan_id_is_verified() {
        let pool = pool_with_plans_schema().await;
        let created: i64 = sqlx::query_scalar(
            "INSERT INTO plans (feature_id, title, status) VALUES (?, 'p', 'draft') RETURNING id",
        )
        .bind(7_i64)
        .fetch_one(&pool)
        .await
        .unwrap();

        let resolved = get_or_resolve_plan_id(&json!({ "plan_id": created }), &pool, 7)
            .await
            .unwrap();
        assert_eq!(resolved, created);

        // Mismatched feature must fail.
        let err = get_or_resolve_plan_id(&json!({ "plan_id": created }), &pool, 99)
            .await
            .unwrap_err();
        assert!(err.contains("does not belong"), "unexpected err: {err}");
    }
}
