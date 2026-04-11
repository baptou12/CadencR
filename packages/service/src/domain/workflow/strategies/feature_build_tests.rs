use super::*;

#[test]
fn test_phase_type_mapping() {
    assert_eq!(map_phase_type_to_item_type(Some("setup")), "execute");
    assert_eq!(map_phase_type_to_item_type(Some("value")), "execute");
    assert_eq!(map_phase_type_to_item_type(Some("qa")), "qa");
    assert_eq!(map_phase_type_to_item_type(None), "execute");
    assert_eq!(map_phase_type_to_item_type(Some("unknown")), "execute");
}

#[test]
fn parse_depends_on_empty_string() {
    assert_eq!(parse_depends_on(""), Vec::<String>::new());
    assert_eq!(parse_depends_on("   "), Vec::<String>::new());
}

#[test]
fn parse_depends_on_json_array() {
    assert_eq!(parse_depends_on(r#"["A", "B"]"#), vec!["A", "B"]);
}

#[test]
fn parse_depends_on_json_array_single() {
    assert_eq!(parse_depends_on(r#"["A"]"#), vec!["A"]);
}

#[test]
fn parse_depends_on_comma_separated() {
    assert_eq!(parse_depends_on("A, B"), vec!["A", "B"]);
}

#[test]
fn parse_depends_on_single_value() {
    assert_eq!(parse_depends_on("A"), vec!["A"]);
}

#[test]
fn parse_depends_on_whitespace_handling() {
    assert_eq!(parse_depends_on("  A , B  "), vec!["A", "B"]);
    assert_eq!(parse_depends_on("  A  "), vec!["A"]);
}

#[test]
fn test_agent_type_mapping() {
    let strategy = FeatureBuildStrategy;
    assert!(matches!(
        strategy.agent_type_for_item("execute", None),
        Ok(AgentType::Execute)
    ));
    assert!(matches!(
        strategy.agent_type_for_item("qa", None),
        Ok(AgentType::Qa)
    ));
    assert!(matches!(
        strategy.agent_type_for_item("review", None),
        Ok(AgentType::Review)
    ));
    assert!(matches!(
        strategy.agent_type_for_item("risk", None),
        Ok(AgentType::Risk)
    ));
    assert!(matches!(
        strategy.agent_type_for_item("retro", None),
        Ok(AgentType::Retro)
    ));
    assert!(strategy.agent_type_for_item("unknown", None).is_err());
}

// ── Prompt autonomy tests ──

use crate::domain::workflow::prompts::{
    build_execute_prompt, build_qa_prompt, build_review_prompt,
};

#[test]
fn test_execute_system_prompt_approval_for_autonomy_1() {
    let prompt = build_execute_prompt("Phase 1", "do stuff", "feat: stuff", 1);
    assert!(
        prompt.contains("Ask the user for approval"),
        "autonomy 1 should require approval"
    );
    assert!(
        !prompt.contains("Full Autonomy"),
        "autonomy 1 should not mention full autonomy"
    );
}

#[test]
fn test_execute_system_prompt_moderate_for_autonomy_2() {
    let prompt = build_execute_prompt("Phase 1", "do stuff", "feat: stuff", 2);
    assert!(
        prompt.contains("moderate autonomy") || prompt.contains("Autonomy note"),
        "autonomy 2 should use moderate completion"
    );
}

#[test]
fn test_execute_system_prompt_auto_for_autonomy_3() {
    let prompt = build_execute_prompt("Phase 1", "do stuff", "feat: stuff", 3);
    assert!(
        prompt.contains("Commit your changes first") || prompt.contains("commit has succeeded"),
        "autonomy 3 should use auto completion"
    );
}

#[test]
fn test_qa_system_prompt_approval_for_autonomy_1() {
    let prompt = build_qa_prompt("QA Phase", "test stuff", 1);
    assert!(
        prompt.contains("Approval Loop") || prompt.contains("AskUserQuestion"),
        "QA autonomy 1 should require approval"
    );
}

#[test]
fn test_qa_system_prompt_auto_for_autonomy_3() {
    let prompt = build_qa_prompt("QA Phase", "test stuff", 3);
    assert!(
        prompt.contains("Full Autonomy") || prompt.contains("FULL AUTONOMY"),
        "QA autonomy 3 should use full autonomy"
    );
}

#[test]
fn test_review_system_prompt_approval_for_autonomy_1() {
    let prompt = build_review_prompt(1);
    assert!(
        prompt.contains("Approval Loop") || prompt.contains("AskUserQuestion"),
        "Review autonomy 1 should require approval"
    );
}

#[test]
fn test_review_system_prompt_auto_for_autonomy_3() {
    let prompt = build_review_prompt(3);
    assert!(
        prompt.contains("Full Autonomy") || prompt.contains("FULL AUTONOMY"),
        "Review autonomy 3 should use full autonomy"
    );
}

// ── Enriched execute prompt autonomy tests (requires DB) ──

async fn test_pool_with_schema() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    sqlx::query("CREATE TABLE projects (id INTEGER PRIMARY KEY, constitution TEXT)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "CREATE TABLE features (id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT, prd TEXT)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "CREATE TABLE plans (id INTEGER PRIMARY KEY, feature_id INTEGER, summary TEXT, context TEXT, clarifications TEXT)"
    ).execute(&pool).await.unwrap();
    sqlx::query(
        "CREATE TABLE phases (id INTEGER PRIMARY KEY, plan_id INTEGER, step_number INTEGER, title TEXT, \
         status TEXT DEFAULT 'pending', complexity INTEGER, commit_message TEXT, \
         prompt TEXT, phase_type TEXT, implementation_notes TEXT, deviations TEXT, \
         order_index INTEGER DEFAULT 0, depends_on TEXT)"
    ).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO projects (id) VALUES (1)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO features (id, project_id, title) VALUES (1, 1, 'Test Feature')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO plans (id, feature_id, summary) VALUES (1, 1, 'test plan')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO phases (id, plan_id, step_number, title, prompt, commit_message) VALUES (1, 1, 1, 'Test Phase', 'implement it', 'feat: test')"
    ).execute(&pool).await.unwrap();
    pool
}

#[tokio::test]
async fn test_enriched_execute_prompt_autonomy_1_shows_approval() {
    let pool = test_pool_with_schema().await;
    let phase: Phase = sqlx::query_as("SELECT * FROM phases WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    let prompt = super::feature_build_prompts::build_enriched_execute_prompt(&pool, &phase, 1, 0)
        .await
        .unwrap();
    assert!(
        prompt.contains("User Approval Required"),
        "autonomy 1 initial prompt should require user approval"
    );
    assert!(
        !prompt.contains("Auto-Commit"),
        "autonomy 1 initial prompt should NOT contain Auto-Commit"
    );
}

#[tokio::test]
async fn test_enriched_execute_prompt_autonomy_3_shows_auto_commit() {
    let pool = test_pool_with_schema().await;
    let phase: Phase = sqlx::query_as("SELECT * FROM phases WHERE id = 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    let prompt = super::feature_build_prompts::build_enriched_execute_prompt(&pool, &phase, 3, 0)
        .await
        .unwrap();
    assert!(
        prompt.contains("Auto-Commit"),
        "autonomy 3 initial prompt should contain Auto-Commit"
    );
    assert!(
        !prompt.contains("User Approval Required"),
        "autonomy 3 initial prompt should NOT require approval"
    );
}
