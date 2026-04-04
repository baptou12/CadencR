#[cfg(test)]
mod repository_tests {
    use sqlx::SqlitePool;
    use sqlx::sqlite::SqlitePoolOptions;

    use crate::domain::ws_workflow::models::*;
    use crate::domain::ws_workflow::{artifact_repository, repository};
    use crate::domain::ws_workflow::presets;

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
                UNIQUE(workflow_definition_id, slug), \
                UNIQUE(workflow_definition_id, order_index))"
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE workflow_artifacts (\
                id INTEGER PRIMARY KEY, \
                feature_id INTEGER NOT NULL, \
                phase_slug TEXT NOT NULL, \
                content TEXT NOT NULL DEFAULT '', \
                agent_session_id INTEGER, \
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, \
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, \
                UNIQUE(feature_id, phase_slug))"
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "CREATE TABLE features (\
                id INTEGER PRIMARY KEY, \
                project_id INTEGER, \
                title TEXT, \
                prd TEXT, \
                status TEXT DEFAULT 'in_progress', \
                workflow_definition_id INTEGER)"
        )
        .execute(&pool)
        .await
        .unwrap();

        pool
    }

    fn make_phase(order: i32, name: &str, slug: &str, gate: GateType) -> CreateWorkflowPhase {
        CreateWorkflowPhase {
            name: name.to_string(),
            slug: slug.to_string(),
            order_index: order,
            gate_type: gate,
            system_prompt_template: format!("{} system", name),
            command_prompt_template: format!("{} command", name),
            artifact_template: format!("{} artifact", name),
            input_phase_slugs: vec![],
            model_override: String::new(),
        }
    }

    fn make_definition(name: &str, slug: &str, phases: Vec<CreateWorkflowPhase>) -> CreateWorkflowDefinition {
        CreateWorkflowDefinition {
            name: name.to_string(),
            slug: slug.to_string(),
            description: Some(format!("{} description", name)),
            is_preset: false,
            phases,
        }
    }

    #[tokio::test]
    async fn test_create_workflow_definition() {
        let pool = setup_pool().await;
        let input = make_definition(
            "Test Workflow",
            "test-workflow",
            vec![
                make_phase(0, "Plan", "plan", GateType::Approval),
                make_phase(1, "Build", "build", GateType::Auto),
            ],
        );

        let def = repository::create_workflow_definition(&pool, input).await.unwrap();
        assert_eq!(def.name, "Test Workflow");
        assert_eq!(def.slug, "test-workflow");
        assert_eq!(def.description, Some("Test Workflow description".to_string()));
        assert!(!def.is_preset);
        assert_eq!(def.phases.len(), 2);
        assert_eq!(def.phases[0].slug, "plan");
        assert_eq!(def.phases[0].gate_type, "approval");
        assert_eq!(def.phases[1].slug, "build");
        assert_eq!(def.phases[1].gate_type, "auto");
    }

    #[tokio::test]
    async fn test_list_workflow_definitions() {
        let pool = setup_pool().await;

        let d1 = make_definition("Alpha", "alpha", vec![make_phase(0, "P1", "p1", GateType::Auto)]);
        let mut d2 = make_definition("Beta", "beta", vec![make_phase(0, "P1", "p1", GateType::Auto)]);
        d2.is_preset = true;

        repository::create_workflow_definition(&pool, d1).await.unwrap();
        repository::create_workflow_definition(&pool, d2).await.unwrap();

        let all = repository::list_workflow_definitions(&pool).await.unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].name, "Alpha");
        assert_eq!(all[1].name, "Beta");

        // Verify preset filtering works via field
        let presets: Vec<_> = all.iter().filter(|d| d.is_preset).collect();
        assert_eq!(presets.len(), 1);
        assert_eq!(presets[0].slug, "beta");
    }

    #[tokio::test]
    async fn test_fork_workflow_definition() {
        let pool = setup_pool().await;
        let mut input = make_definition(
            "Original",
            "original",
            vec![
                make_phase(0, "Plan", "plan", GateType::Approval),
                make_phase(1, "Build", "build", GateType::Auto),
            ],
        );
        input.is_preset = true;

        let original = repository::create_workflow_definition(&pool, input).await.unwrap();
        let forked = repository::fork_workflow_definition(&pool, original.id, "My Fork", "my-fork")
            .await
            .unwrap();

        assert_eq!(forked.name, "My Fork");
        assert_eq!(forked.slug, "my-fork");
        assert!(!forked.is_preset);
        assert_eq!(forked.phases.len(), 2);
        assert_eq!(forked.phases[0].slug, "plan");
        assert_eq!(forked.phases[1].slug, "build");
        assert_ne!(forked.id, original.id);
    }

    #[tokio::test]
    async fn test_delete_workflow_definition_blocked() {
        let pool = setup_pool().await;
        let input = make_definition("ToDelete", "to-delete", vec![make_phase(0, "P", "p", GateType::Auto)]);
        let def = repository::create_workflow_definition(&pool, input).await.unwrap();

        // Create a feature referencing this definition with in-progress status
        sqlx::query("INSERT INTO features (id, project_id, title, status, workflow_definition_id) VALUES (1, 1, 'F1', 'in_progress', ?)")
            .bind(def.id)
            .execute(&pool)
            .await
            .unwrap();

        let result = repository::delete_workflow_definition(&pool, def.id).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_delete_workflow_definition_success() {
        let pool = setup_pool().await;
        let input = make_definition("ToDelete", "to-delete", vec![make_phase(0, "P", "p", GateType::Auto)]);
        let def = repository::create_workflow_definition(&pool, input).await.unwrap();

        repository::delete_workflow_definition(&pool, def.id).await.unwrap();

        let result = repository::get_workflow_definition(&pool, def.id).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_upsert_artifact() {
        let pool = setup_pool().await;

        // Create
        let a1 = artifact_repository::upsert_artifact(&pool, 1, "plan", "initial content", None)
            .await
            .unwrap();
        assert_eq!(a1.content, "initial content");
        assert_eq!(a1.phase_slug, "plan");

        // Overwrite
        let a2 = artifact_repository::upsert_artifact(&pool, 1, "plan", "updated content", Some(42))
            .await
            .unwrap();
        assert_eq!(a2.content, "updated content");
        assert_eq!(a2.agent_session_id, Some(42));
        assert_eq!(a2.id, a1.id);
    }

    #[tokio::test]
    async fn test_get_artifacts_for_feature() {
        let pool = setup_pool().await;

        artifact_repository::upsert_artifact(&pool, 1, "plan", "plan content", None).await.unwrap();
        artifact_repository::upsert_artifact(&pool, 1, "prd", "prd content", None).await.unwrap();
        artifact_repository::upsert_artifact(&pool, 1, "build", "build content", None).await.unwrap();
        // Different feature
        artifact_repository::upsert_artifact(&pool, 2, "plan", "other", None).await.unwrap();

        let artifacts = artifact_repository::get_artifacts_for_feature(&pool, 1).await.unwrap();
        assert_eq!(artifacts.len(), 3);
    }

    #[tokio::test]
    async fn test_seed_presets_idempotent() {
        let pool = setup_pool().await;

        presets::seed_presets(&pool).await.unwrap();
        presets::seed_presets(&pool).await.unwrap();

        let all = repository::list_workflow_definitions(&pool).await.unwrap();
        let preset_count = all.iter().filter(|d| d.is_preset).count();
        assert_eq!(preset_count, 4);
    }

    #[tokio::test]
    async fn test_preset_phases_correct() {
        let pool = setup_pool().await;
        presets::seed_presets(&pool).await.unwrap();

        let all = repository::list_workflow_definitions(&pool).await.unwrap();

        let speckit = all.iter().find(|d| d.slug == "speckit").unwrap();
        assert_eq!(speckit.phases.len(), 6);
        assert_eq!(speckit.phases[0].gate_type, "manual");

        let bmad = all.iter().find(|d| d.slug == "bmad").unwrap();
        assert_eq!(bmad.phases.len(), 4);
        assert_eq!(bmad.phases[0].gate_type, "approval");

        let openspec = all.iter().find(|d| d.slug == "openspec").unwrap();
        assert_eq!(openspec.phases.len(), 3);
        assert_eq!(openspec.phases[0].gate_type, "approval");

        let cadence = all.iter().find(|d| d.slug == "cadence-default").unwrap();
        assert_eq!(cadence.phases.len(), 3);
        assert_eq!(cadence.phases[2].gate_type, "auto");
    }
}

#[cfg(test)]
mod template_engine_tests {
    use std::collections::HashMap;
    use crate::domain::ws_workflow::template_engine::{interpolate, TemplateContext};

    fn ctx() -> TemplateContext {
        let mut phase_artifacts = HashMap::new();
        phase_artifacts.insert("prd".to_string(), "PRD output".to_string());
        phase_artifacts.insert("plan".to_string(), "Plan output".to_string());

        TemplateContext {
            feature_title: "My Feature".to_string(),
            feature_description: "Feature desc".to_string(),
            project_name: "TestProject".to_string(),
            project_path: "/tmp/test".to_string(),
            phase_name: "Build".to_string(),
            prior_artifacts: "Prior content".to_string(),
            phase_artifacts,
            date: "2025-06-15".to_string(),
        }
    }

    #[test]
    fn test_interpolate_known_variables() {
        let c = ctx();
        let tpl = "{{feature_title}} | {{feature_description}} | {{project_name}} | {{project_path}} | {{phase_name}} | {{prior_artifacts}} | {{date}}";
        let result = interpolate(tpl, &c);
        assert_eq!(
            result,
            "My Feature | Feature desc | TestProject | /tmp/test | Build | Prior content | 2025-06-15"
        );
    }

    #[test]
    fn test_interpolate_artifact_reference() {
        let c = ctx();
        let result = interpolate("See PRD: {{artifact:prd}} and Plan: {{artifact:plan}}", &c);
        assert_eq!(result, "See PRD: PRD output and Plan: Plan output");
    }

    #[test]
    fn test_interpolate_unknown_variable_preserved() {
        let c = ctx();
        let result = interpolate("{{unknown}} stays here", &c);
        assert_eq!(result, "{{unknown}} stays here");
    }

    #[test]
    fn test_interpolate_empty_template() {
        let c = ctx();
        let result = interpolate("", &c);
        assert_eq!(result, "");
    }
}

#[cfg(test)]
mod strategy_tests {
    use crate::domain::mcp::servers::AgentType;
    use crate::domain::workflow::strategies::custom_workflow::CustomWorkflowStrategy;
    use crate::domain::workflow::strategies::WorkflowStrategy;

    #[test]
    fn test_agent_type_for_item() {
        let strategy = CustomWorkflowStrategy { workflow_definition_id: 1 };

        // Implementation-type phases → Execute
        assert!(matches!(strategy.agent_type_for_item("implement"), Ok(AgentType::Execute)));
        assert!(matches!(strategy.agent_type_for_item("build"), Ok(AgentType::Execute)));
        assert!(matches!(strategy.agent_type_for_item("apply"), Ok(AgentType::Execute)));

        // Other phases → Workflow
        assert!(matches!(strategy.agent_type_for_item("plan"), Ok(AgentType::Workflow)));
        assert!(matches!(strategy.agent_type_for_item("prd"), Ok(AgentType::Workflow)));
        assert!(matches!(strategy.agent_type_for_item("analyze"), Ok(AgentType::Workflow)));
    }
}
