use sqlx::SqlitePool;
use tracing::info;

use crate::error::AppError;
use super::models::{CreateWorkflowDefinition, CreateWorkflowPhase, GateType};
use super::repository;

fn phase(
    order: i32,
    name: &str,
    slug: &str,
    gate: GateType,
    inputs: &[&str],
) -> CreateWorkflowPhase {
    CreateWorkflowPhase {
        name: name.to_string(),
        slug: slug.to_string(),
        order_index: order,
        gate_type: gate,
        system_prompt_template: String::new(),
        command_prompt_template: String::new(),
        artifact_template: String::new(),
        input_phase_slugs: inputs.iter().map(|s| s.to_string()).collect(),
        model_override: String::new(),
    }
}

fn preset(
    name: &str,
    slug: &str,
    description: &str,
    phases: Vec<CreateWorkflowPhase>,
) -> CreateWorkflowDefinition {
    CreateWorkflowDefinition {
        name: name.to_string(),
        slug: slug.to_string(),
        description: Some(description.to_string()),
        is_preset: true,
        phases,
    }
}

pub fn get_preset_definitions() -> Vec<CreateWorkflowDefinition> {
    use GateType::*;

    vec![
        preset(
            "Speckit",
            "speckit",
            "Speckit-style workflow: constitution, specify, plan, tasks, implement, analyze",
            vec![
                phase(0, "Constitution", "constitution", Manual, &[]),
                phase(1, "Specify", "specify", Approval, &["constitution"]),
                phase(2, "Plan", "plan", Approval, &["constitution", "specify"]),
                phase(3, "Tasks", "tasks", Auto, &["plan"]),
                phase(4, "Implement", "implement", Auto, &["tasks"]),
                phase(5, "Analyze", "analyze", Approval, &["specify", "implement"]),
            ],
        ),
        preset(
            "BMAD",
            "bmad",
            "BMAD-style workflow: analysis, planning, solutioning, implementation",
            vec![
                phase(0, "Analysis", "analysis", Approval, &[]),
                phase(1, "Planning", "planning", Approval, &["analysis"]),
                phase(2, "Solutioning", "solutioning", Approval, &["analysis", "planning"]),
                phase(3, "Implementation", "implementation", Auto, &["solutioning"]),
            ],
        ),
        preset(
            "OpenSpec",
            "openspec",
            "OpenSpec-style workflow: propose, apply, archive",
            vec![
                phase(0, "Propose", "propose", Approval, &[]),
                phase(1, "Apply", "apply", Auto, &["propose"]),
                phase(2, "Archive", "archive", Auto, &["apply"]),
            ],
        ),
        preset(
            "Cadence Default",
            "cadence-default",
            "Default Cadence workflow: plan, PRD, build",
            vec![
                phase(0, "Plan", "plan", Approval, &[]),
                phase(1, "PRD", "prd", Approval, &["plan"]),
                phase(2, "Build", "build", Auto, &["prd"]),
            ],
        ),
    ]
}

/// Idempotently seed preset workflow definitions. Skips any preset whose slug
/// already exists in the database.
pub async fn seed_presets(pool: &SqlitePool) -> Result<(), AppError> {
    for def in get_preset_definitions() {
        let existing = repository::get_workflow_definition_by_slug(pool, &def.slug).await?;
        if existing.is_none() {
            repository::create_workflow_definition(pool, def.clone()).await?;
            info!("Seeded preset workflow: {}", def.slug);
        }
    }
    Ok(())
}
