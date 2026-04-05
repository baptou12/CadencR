pub mod templates;

use sqlx::SqlitePool;
use tracing::info;

use crate::error::AppError;
use super::models::{CreateWorkflowDefinition, CreateWorkflowPhase, GateType};
use super::repository;

fn default_model_for_agent_type(agent_type: &str) -> &str {
    match agent_type {
        "execute" => "sonnet",
        _ => "opus",
    }
}

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
    phase_with_agent_type(order, name, slug, gate, inputs, system_prompt, command_prompt, artifact, "workflow")
}

#[allow(clippy::too_many_arguments)]
fn phase_with_agent_type(
    order: i32,
    name: &str,
    slug: &str,
    gate: GateType,
    inputs: &[&str],
    system_prompt: &str,
    command_prompt: &str,
    artifact: &str,
    agent_type: &str,
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
        model_override: default_model_for_agent_type(agent_type).to_string(),
        agent_type: agent_type.to_string(),
        decompose_from: String::new(),
    }
}

/// Create an execute phase that decomposes from a specific upstream phase's tasks.
#[allow(clippy::too_many_arguments)]
fn decomposable_execute_phase(
    order: i32,
    name: &str,
    slug: &str,
    gate: GateType,
    inputs: &[&str],
    decompose_from: &str,
    system_prompt: &str,
    command_prompt: &str,
    artifact: &str,
) -> CreateWorkflowPhase {
    let mut phase = phase_with_agent_type(order, name, slug, gate, inputs, system_prompt, command_prompt, artifact, "execute");
    phase.decompose_from = decompose_from.to_string();
    phase
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
            "Speckit-style workflow: specify, plan, tasks, implement, analyze",
            vec![
                phase(0, "Specify", "specify", Approval, &[],
                    sk::SPECIFY_SYSTEM, sk::SPECIFY_COMMAND, sk::SPECIFY_ARTIFACT),
                phase(1, "Plan", "plan", Approval, &["specify"],
                    sk::PLAN_SYSTEM, sk::PLAN_COMMAND, sk::PLAN_ARTIFACT),
                phase(2, "Tasks", "tasks", Auto, &["plan"],
                    sk::TASKS_SYSTEM, sk::TASKS_COMMAND, sk::TASKS_ARTIFACT),
                decomposable_execute_phase(3, "Implement", "implement", Auto, &["tasks"], "tasks",
                    sk::IMPLEMENT_SYSTEM, sk::IMPLEMENT_COMMAND, sk::IMPLEMENT_ARTIFACT),
                phase(4, "Analyze", "analyze", Approval, &["specify", "implement"],
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
                decomposable_execute_phase(3, "Implementation", "implementation", Auto, &["solutioning"], "solutioning",
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
                decomposable_execute_phase(1, "Apply", "apply", Auto, &["propose"], "propose",
                    os::APPLY_SYSTEM, os::APPLY_COMMAND, os::APPLY_ARTIFACT),
                phase(2, "Archive", "archive", Auto, &["apply"],
                    os::ARCHIVE_SYSTEM, os::ARCHIVE_COMMAND, os::ARCHIVE_ARTIFACT),
            ],
        ),
        preset(
            "Cadence",
            "cadence-default",
            "Default Cadence workflow: PRD, plan, build",
            vec![
                phase(0, "PRD", "prd", Approval, &[],
                    cd::PRD_SYSTEM, cd::PRD_COMMAND, cd::PRD_ARTIFACT),
                phase(1, "Plan", "plan", Approval, &["prd"],
                    cd::PLAN_SYSTEM, cd::PLAN_COMMAND, cd::PLAN_ARTIFACT),
                decomposable_execute_phase(2, "Build", "build", Auto, &["plan"], "plan",
                    cd::BUILD_SYSTEM, cd::BUILD_COMMAND, cd::BUILD_ARTIFACT),
            ],
        ),
    ]
}

/// Idempotently seed preset workflow definitions.
/// Re-creates a preset if its phase count has changed (e.g., Constitution removed from Speckit).
pub async fn seed_presets(pool: &SqlitePool) -> Result<(), AppError> {
    for def in get_preset_definitions() {
        let expected_phases = def.phases.len();
        let existing = repository::get_workflow_definition_by_slug(pool, &def.slug).await?;
        match existing {
            None => {
                repository::create_workflow_definition(pool, def.clone()).await?;
                info!("Seeded preset workflow: {}", def.slug);
            }
            Some(ex) if ex.phases.len() != expected_phases => {
                info!(
                    slug = %def.slug,
                    old_phases = ex.phases.len(),
                    new_phases = expected_phases,
                    "Re-seeding preset (phase count changed)"
                );
                repository::delete_workflow_definition(pool, ex.id).await?;
                repository::create_workflow_definition(pool, def.clone()).await?;
            }
            Some(ex) => {
                // Backfill empty model_override with defaults
                for existing_phase in &ex.phases {
                    if existing_phase.model_override.is_empty() {
                        let default = default_model_for_agent_type(&existing_phase.agent_type);
                        super::phase_repository::update_workflow_phase(
                            pool,
                            existing_phase.id,
                            None, None, None, None, None, None,
                            Some(default),
                            None,
                        ).await?;
                    }
                }
            }
        }
    }
    Ok(())
}
