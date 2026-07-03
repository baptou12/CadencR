use sqlx::SqlitePool;

use super::super::models::CustomActionVariable;
use crate::error::AppError;

// ---------------------------------------------------------------------------
// custom_action_variables
// ---------------------------------------------------------------------------

pub async fn list_variables(
    pool: &SqlitePool,
    action_id: i64,
    feature_id: i64,
) -> Result<Vec<CustomActionVariable>, AppError> {
    let rows = sqlx::query_as::<_, CustomActionVariable>(
        r#"SELECT var_name, value FROM custom_action_variables
           WHERE action_id = ? AND feature_id = ?"#,
    )
    .bind(action_id)
    .bind(feature_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn upsert_variable(
    pool: &SqlitePool,
    action_id: i64,
    feature_id: i64,
    var_name: &str,
    value: &str,
) -> Result<(), AppError> {
    sqlx::query(
        r#"INSERT INTO custom_action_variables (action_id, feature_id, var_name, value)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(action_id, feature_id, var_name) DO UPDATE SET value = excluded.value"#,
    )
    .bind(action_id)
    .bind(feature_id)
    .bind(var_name)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::test_support::pool_with_project_and_feature;
    use super::*;
    use crate::domain::custom_actions::models::Scope;
    use crate::domain::custom_actions::repository::insert;
    #[tokio::test]
    async fn upsert_variable_overwrites_existing_value() {
        let (pool, project_id, feature_id) = pool_with_project_and_feature().await;
        let action_id = insert(
            &pool,
            "n",
            "echo",
            None,
            Scope::Project,
            Some(project_id),
            false,
        )
        .await
        .unwrap();
        upsert_variable(&pool, action_id, feature_id, "X", "first")
            .await
            .unwrap();
        upsert_variable(&pool, action_id, feature_id, "X", "second")
            .await
            .unwrap();
        let vars = list_variables(&pool, action_id, feature_id).await.unwrap();
        assert_eq!(vars.len(), 1);
        assert_eq!(vars[0].value, "second");
    }
}
