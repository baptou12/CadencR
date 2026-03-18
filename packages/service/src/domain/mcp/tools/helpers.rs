use rmcp::model::{CallToolResult, Content};
use sqlx::SqlitePool;

/// Extract a required i64 parameter from JSON args, returning a clear error if missing.
pub fn require_i64(args: &serde_json::Value, key: &str) -> Result<i64, String> {
    args[key]
        .as_i64()
        .ok_or_else(|| format!("Missing required parameter: {key}"))
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
