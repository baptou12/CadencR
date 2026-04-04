pub mod templates;

use sqlx::SqlitePool;
use tracing::info;

use crate::error::AppError;
use super::models::{CreateWorkflowDefinition, CreateWorkflowPhase, GateType};
use super::repository;

#[allow(clippy::too_many_arguments)]
fn phase(
    order: i32,
    name: &str,
    slug: &str,
    gate: GateType,
    inputs: &[&str],
    system_prompt: &str,
    command_prompt: &str,
    artifact: &str,
) -> CreateWorkflowPhase {
    CreateWorkflowPhase {
        name: name.to_string(),
        slug: slug.to_string(),
        order_index: order,
        gate_type: gate,
        system_prompt_template: system_prompt.to_string(),
        command_prompt_template: command_prompt.to_string(),
        artifact_template: artifact.to_string(),
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
    use templates::speckit as sk;
    use templates::bmad as bm;
    use templates::openspec as os;
    use templates::cadence_default as cd;

    vec![
        preset(
            "Speckit",
            "speckit",
            "Speckit-style workflow: constitution, specify, plan, tasks, implement, analyze",
            vec![
                phase(0, "Constitution", "constitution", Manual, &[],
                    sk::CONSTITUTION_SYSTEM, sk::CONSTITUTION_COMMAND, sk::CONSTITUTION_ARTIFACT),
                phase(1, "Specify", "specify", Approval, &["constitution"],
                    sk::SPECIFY_SYSTEM, sk::SPECIFY_COMMAND, sk::SPECIFY_ARTIFACT),
                phase(2, "Plan", "plan", Approval, &["constitution", "specify"],
                    sk::PLAN_SYSTEM, sk::PLAN_COMMAND, sk::PLAN_ARTIFACT),
                phase(3, "Tasks", "tasks", Auto, &["plan"],
                    sk::TASKS_SYSTEM, sk::TASKS_COMMAND, sk::TASKS_ARTIFACT),
                phase(4, "Implement", "implement", Auto, &["tasks"],
                    sk::IMPLEMENT_SYSTEM, sk::IMPLEMENT_COMMAND, sk::IMPLEMENT_ARTIFACT),
                phase(5, "Analyze", "analyze", Approval, &["specify", "implement"],
                    sk::ANALYZE_SYSTEM, sk::ANALYZE_COMMAND, sk::ANALYZE_ARTIFACT),
            ],
        ),
        preset(
            "BMAD",
            "bmad",
            "BMAD-style workflow: analysis, planning, solutioning, implementation",
            vec![
                phase(0, "Analysis", "analysis", Approval, &[],
                    bm::ANALYSIS_SYSTEM, bm::ANALYSIS_COMMAND, bm::ANALYSIS_ARTIFACT),
                phase(1, "Planning", "planning", Approval, &["analysis"],
                    bm::PLANNING_SYSTEM, bm::PLANNING_COMMAND, bm::PLANNING_ARTIFACT),
                phase(2, "Solutioning", "solutioning", Approval, &["analysis", "planning"],
                    bm::SOLUTIONING_SYSTEM, bm::SOLUTIONING_COMMAND, bm::SOLUTIONING_ARTIFACT),
                phase(3, "Implementation", "implementation", Auto, &["solutioning"],
                    bm::IMPLEMENTATION_SYSTEM, bm::IMPLEMENTATION_COMMAND, bm::IMPLEMENTATION_ARTIFACT),
            ],
        ),
        preset(
            "OpenSpec",
            "openspec",
            "OpenSpec-style workflow: propose, apply, archive",
            vec![
                phase(0, "Propose", "propose", Approval, &[],
                    os::PROPOSE_SYSTEM, os::PROPOSE_COMMAND, os::PROPOSE_ARTIFACT),
                phase(1, "Apply", "apply", Auto, &["propose"],
                    os::APPLY_SYSTEM, os::APPLY_COMMAND, os::APPLY_ARTIFACT),
                phase(2, "Archive", "archive", Auto, &["apply"],
                    os::ARCHIVE_SYSTEM, os::ARCHIVE_COMMAND, os::ARCHIVE_ARTIFACT),
            ],
        ),
        preset(
            "Cadence Default",
            "cadence-default",
            "Default Cadence workflow: plan, PRD, build",
            vec![
                phase(0, "Plan", "plan", Approval, &[],
                    cd::PLAN_SYSTEM, cd::PLAN_COMMAND, cd::PLAN_ARTIFACT),
                phase(1, "PRD", "prd", Approval, &["plan"],
                    cd::PRD_SYSTEM, cd::PRD_COMMAND, cd::PRD_ARTIFACT),
                phase(2, "Build", "build", Auto, &["prd"],
                    cd::BUILD_SYSTEM, cd::BUILD_COMMAND, cd::BUILD_ARTIFACT),
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
