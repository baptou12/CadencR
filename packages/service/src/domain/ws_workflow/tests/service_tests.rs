#[cfg(test)]
mod service_tests {
    use sqlx::SqlitePool;
    use sqlx::sqlite::SqlitePoolOptions;

    use crate::domain::ws_workflow::models::*;
    use crate::domain::ws_workflow::service;

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();

        sqlx::query(
            "CREATE TABLE workflow_definitions (\
                id INTEGER PRIMARY KEY, \
                name TEXT NOT NULL, \
                slug TEXT NOT NULL UNIQUE, \
                description TEXT, \
                is_preset BOOLEAN NOT NULL DEFAULT false, \
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, \
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE workflow_phases (\
                id INTEGER PRIMARY KEY, \
                workflow_definition_id INTEGER NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE, \
                name TEXT NOT NULL, \
                slug TEXT NOT NULL, \
                order_index INTEGER NOT NULL, \
                gate_type TEXT NOT NULL CHECK(gate_type IN ('auto', 'approval', 'manual')), \
                system_prompt_template TEXT NOT NULL DEFAULT '', \
                command_prompt_template TEXT NOT NULL DEFAULT '', \
                artifact_template TEXT NOT NULL DEFAULT '', \
                input_phase_slugs TEXT DEFAULT '[]', \
                model_override TEXT DEFAULT '', \
                agent_type TEXT NOT NULL DEFAULT '', \
                UNIQUE(workflow_definition_id, slug), \
                UNIQUE(workflow_definition_id, order_index))"
        )
        .execute(&pool)
        .await
        .unwrap();

        pool
    }

    #[tokio::test]
    async fn test_create_definition_with_zero_phases_returns_error() {
        let pool = setup_pool().await;
        let input = CreateWorkflowDefinition {
            name: "Empty".to_string(),
            slug: "empty".to_string(),
            description: None,
            is_preset: false,
            phases: vec![],
        };

        let result = service::create_definition(&pool, input).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        let err_str = format!("{:?}", err);
        assert!(err_str.contains("at least 1 phase") || err_str.contains("BadRequest"));
    }
}
