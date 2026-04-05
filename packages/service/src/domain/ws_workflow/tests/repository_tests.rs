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
                agent_type TEXT NOT NULL DEFAULT '', \
                decompose_from TEXT NOT NULL DEFAULT '', \
                artifact_types TEXT NOT NULL DEFAULT '[]', \
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
                artifact_type TEXT NOT NULL DEFAULT 'default', \
                content TEXT NOT NULL DEFAULT '', \
                agent_session_id INTEGER, \
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, \
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, \
                UNIQUE(feature_id, phase_slug, artifact_type))"
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
            agent_type: String::new(),
            decompose_from: String::new(),
            artifact_types: vec![],
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
    async fn test_preset_phase_mutations_blocked() {
        let pool = setup_pool().await;
        let mut input = make_definition(
            "Preset WF",
            "preset-wf",
            vec![make_phase(0, "Phase1", "phase1", GateType::Auto)],
        );
        input.is_preset = true;
        let def = repository::create_workflow_definition(&pool, input).await.unwrap();
        let phase_id = def.phases[0].id;

        // add_phase should fail
        let new_phase = make_phase(1, "Phase2", "phase2", GateType::Auto);
        let add_result = crate::domain::ws_workflow::service::add_phase(&pool, def.id, &new_phase).await;
        assert!(add_result.is_err());

        // update_phase should fail
        let update_result = crate::domain::ws_workflow::service::update_phase(
            &pool, phase_id, Some("New Name"), None, None, None, None, None, None, None, None,
        ).await;
        assert!(update_result.is_err());

        // delete_phase should fail
        let delete_result = crate::domain::ws_workflow::service::delete_phase(&pool, phase_id).await;
        assert!(delete_result.is_err());

        // reorder_phases should fail
        let reorder_result = crate::domain::ws_workflow::service::reorder_phases(&pool, def.id, &[phase_id]).await;
        assert!(reorder_result.is_err());
    }

    #[tokio::test]
    async fn test_upsert_artifact() {
        let pool = setup_pool().await;

        // Create
        let a1 = artifact_repository::upsert_artifact(&pool, 1, "plan", "default", "initial content", None)
            .await
            .unwrap();
        assert_eq!(a1.content, "initial content");
        assert_eq!(a1.phase_slug, "plan");

        // Overwrite
        let a2 = artifact_repository::upsert_artifact(&pool, 1, "plan", "default", "updated content", Some(42))
            .await
            .unwrap();
        assert_eq!(a2.content, "updated content");
        assert_eq!(a2.agent_session_id, Some(42));
        assert_eq!(a2.id, a1.id);
    }

    #[tokio::test]
    async fn test_get_artifacts_for_feature() {
        let pool = setup_pool().await;

        artifact_repository::upsert_artifact(&pool, 1, "plan", "default", "plan content", None).await.unwrap();
        artifact_repository::upsert_artifact(&pool, 1, "prd", "default", "prd content", None).await.unwrap();
        artifact_repository::upsert_artifact(&pool, 1, "build", "default", "build content", None).await.unwrap();
        // Different feature
        artifact_repository::upsert_artifact(&pool, 2, "plan", "default", "other", None).await.unwrap();

        let artifacts = artifact_repository::get_artifacts_for_feature(&pool, 1).await.unwrap();
        assert_eq!(artifacts.len(), 3);
    }

    #[tokio::test]
    async fn test_typed_artifacts() {
        let pool = setup_pool().await;

        // Create multiple typed artifacts for same phase
        let a1 = artifact_repository::upsert_artifact(&pool, 1, "propose", "proposal", "proposal content", None).await.unwrap();
        let a2 = artifact_repository::upsert_artifact(&pool, 1, "propose", "specs", "specs content", None).await.unwrap();
        assert_ne!(a1.id, a2.id);
        assert_eq!(a1.artifact_type, "proposal");
        assert_eq!(a2.artifact_type, "specs");

        // get_typed_artifact returns specific type
        let fetched = artifact_repository::get_typed_artifact(&pool, 1, "propose", "specs").await.unwrap().unwrap();
        assert_eq!(fetched.content, "specs content");

        // get_artifact returns only default type
        let default = artifact_repository::get_artifact(&pool, 1, "propose").await.unwrap();
        assert!(default.is_none()); // no "default" type exists

        // Create a default artifact too
        artifact_repository::upsert_artifact(&pool, 1, "propose", "default", "default content", None).await.unwrap();
        let default = artifact_repository::get_artifact(&pool, 1, "propose").await.unwrap().unwrap();
        assert_eq!(default.content, "default content");

        // get_phase_artifacts returns all types for a phase
        let all = artifact_repository::get_phase_artifacts(&pool, 1, "propose").await.unwrap();
        assert_eq!(all.len(), 3);

        // Upsert overwrites same (phase_slug, artifact_type) pair
        artifact_repository::upsert_artifact(&pool, 1, "propose", "specs", "updated specs", None).await.unwrap();
        let updated = artifact_repository::get_typed_artifact(&pool, 1, "propose", "specs").await.unwrap().unwrap();
        assert_eq!(updated.content, "updated specs");
        assert_eq!(updated.id, a2.id); // same row
    }

    #[test]
    fn test_format_artifacts_empty() {
        assert_eq!(artifact_repository::format_artifacts(&[], None), None);
    }

    #[test]
    fn test_format_artifacts_single_default() {
        use crate::domain::ws_workflow::models::WorkflowArtifact;
        let artifacts = vec![WorkflowArtifact {
            id: 1, feature_id: 1, phase_slug: "plan".into(),
            artifact_type: "default".into(), content: "plan content".into(),
            agent_session_id: None, created_at: String::new(), updated_at: String::new(),
        }];
        // Without prefix: just content
        assert_eq!(artifact_repository::format_artifacts(&artifacts, None), Some("plan content".into()));
        // With prefix: header + content
        let with_prefix = artifact_repository::format_artifacts(&artifacts, Some("plan")).unwrap();
        assert!(with_prefix.starts_with("## plan\n\n"));
        assert!(with_prefix.contains("plan content"));
    }

    #[test]
    fn test_format_artifacts_multiple_typed() {
        use crate::domain::ws_workflow::models::WorkflowArtifact;
        let artifacts = vec![
            WorkflowArtifact {
                id: 1, feature_id: 1, phase_slug: "propose".into(),
                artifact_type: "proposal".into(), content: "proposal text".into(),
                agent_session_id: None, created_at: String::new(), updated_at: String::new(),
            },
            WorkflowArtifact {
                id: 2, feature_id: 1, phase_slug: "propose".into(),
                artifact_type: "specs".into(), content: "specs text".into(),
                agent_session_id: None, created_at: String::new(), updated_at: String::new(),
            },
        ];
        let result = artifact_repository::format_artifacts(&artifacts, None).unwrap();
        assert!(result.contains("## proposal"));
        assert!(result.contains("## specs"));
        assert!(result.contains("---"));

        // With prefix
        let result = artifact_repository::format_artifacts(&artifacts, Some("Phase: propose")).unwrap();
        assert!(result.contains("## Phase: propose / proposal"));
        assert!(result.contains("## Phase: propose / specs"));
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
        assert_eq!(speckit.phases.len(), 5);
        assert_eq!(speckit.phases[0].gate_type, "approval");

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

    #[tokio::test]
    async fn test_preset_prompts_loaded_from_markdown() {
        let pool = setup_pool().await;
        presets::seed_presets(&pool).await.unwrap();

        let all = repository::list_workflow_definitions(&pool).await.unwrap();

        // Every phase of every preset should have non-empty prompts (loaded from .md files)
        for def in all.iter().filter(|d| d.is_preset) {
            for phase in &def.phases {
                assert!(!phase.system_prompt_template.is_empty(),
                    "{}:{} system_prompt is empty", def.slug, phase.slug);
                assert!(!phase.command_prompt_template.is_empty(),
                    "{}:{} command_prompt is empty", def.slug, phase.slug);
                assert!(!phase.artifact_template.is_empty(),
                    "{}:{} artifact_template is empty", def.slug, phase.slug);
            }
        }
    }

    #[tokio::test]
    async fn test_preset_descriptions_contain_version() {
        let defs = presets::get_preset_definitions();

        let speckit = defs.iter().find(|d| d.slug == "speckit").unwrap();
        assert!(speckit.description.as_ref().unwrap().contains("Spec-Kit v"));

        let bmad = defs.iter().find(|d| d.slug == "bmad").unwrap();
        assert!(bmad.description.as_ref().unwrap().contains("BMAD Method v"));

        let openspec = defs.iter().find(|d| d.slug == "openspec").unwrap();
        assert!(openspec.description.as_ref().unwrap().contains("OpenSpec v"));
    }

    #[tokio::test]
    async fn test_seed_updates_prompt_content() {
        use crate::domain::ws_workflow::phase_repository;

        let pool = setup_pool().await;
        presets::seed_presets(&pool).await.unwrap();

        // Manually overwrite a phase's prompt to simulate stale content
        let all = repository::list_workflow_definitions(&pool).await.unwrap();
        let bmad = all.iter().find(|d| d.slug == "bmad").unwrap();
        let analysis = bmad.phases.iter().find(|p| p.slug == "analysis").unwrap();
        phase_repository::update_workflow_phase(
            &pool, analysis.id,
            None, None, Some("stale system prompt"), None, None, None, None, None, None,
        ).await.unwrap();

        // Re-seed should restore the correct prompt
        presets::seed_presets(&pool).await.unwrap();

        let all = repository::list_workflow_definitions(&pool).await.unwrap();
        let bmad = all.iter().find(|d| d.slug == "bmad").unwrap();
        let analysis = bmad.phases.iter().find(|p| p.slug == "analysis").unwrap();
        assert_ne!(analysis.system_prompt_template, "stale system prompt");
        assert!(analysis.system_prompt_template.contains("BMAD Analyst"));
    }

    #[tokio::test]
    async fn test_seed_preserves_user_model_override() {
        use crate::domain::ws_workflow::phase_repository;

        let pool = setup_pool().await;
        presets::seed_presets(&pool).await.unwrap();

        // User overrides model on a phase
        let all = repository::list_workflow_definitions(&pool).await.unwrap();
        let speckit = all.iter().find(|d| d.slug == "speckit").unwrap();
        let specify = speckit.phases.iter().find(|p| p.slug == "specify").unwrap();
        phase_repository::update_workflow_phase(
            &pool, specify.id,
            None, None, None, None, None, None, Some("haiku"), None, None,
        ).await.unwrap();

        // Re-seed should preserve the user's model choice
        presets::seed_presets(&pool).await.unwrap();

        let all = repository::list_workflow_definitions(&pool).await.unwrap();
        let speckit = all.iter().find(|d| d.slug == "speckit").unwrap();
        let specify = speckit.phases.iter().find(|p| p.slug == "specify").unwrap();
        assert_eq!(specify.model_override, "haiku");
    }
}
