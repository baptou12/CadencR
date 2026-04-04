use sqlx::SqlitePool;

use crate::error::AppError;
use super::models::{CreateWorkflowPhase, WorkflowPhase};

pub(super) fn parse_phase_slugs(json: &str, phase_name: &str) -> Vec<String> {
    serde_json::from_str(json).unwrap_or_else(|e| {
        tracing::warn!("Malformed input_phase_slugs JSON for phase {}: {}", phase_name, e);
        vec![]
    })
}

pub(super) async fn insert_phase(
    pool: &SqlitePool,
    definition_id: i64,
    phase: &CreateWorkflowPhase,
) -> Result<i64, AppError> {
    let slugs_json = serde_json::to_string(&phase.input_phase_slugs)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let id = sqlx::query(
        "INSERT INTO workflow_phases \
         (workflow_definition_id, name, slug, order_index, gate_type, \
          system_prompt_template, command_prompt_template, artifact_template, \
          input_phase_slugs, model_override, agent_type) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(definition_id)
    .bind(&phase.name)
    .bind(&phase.slug)
    .bind(phase.order_index)
    .bind(phase.gate_type.to_string())
    .bind(&phase.system_prompt_template)
    .bind(&phase.command_prompt_template)
    .bind(&phase.artifact_template)
    .bind(&slugs_json)
    .bind(&phase.model_override)
    .bind(&phase.agent_type)
    .execute(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?
    .last_insert_rowid();

    Ok(id)
}

pub async fn create_workflow_phase(
    pool: &SqlitePool,
    definition_id: i64,
    phase: &CreateWorkflowPhase,
) -> Result<WorkflowPhase, AppError> {
    let id = insert_phase(pool, definition_id, phase).await?;
    Ok(WorkflowPhase {
        id,
        workflow_definition_id: definition_id,
        name: phase.name.clone(),
        slug: phase.slug.clone(),
        order_index: phase.order_index,
        gate_type: phase.gate_type.to_string(),
        system_prompt_template: phase.system_prompt_template.clone(),
        command_prompt_template: phase.command_prompt_template.clone(),
        artifact_template: phase.artifact_template.clone(),
        input_phase_slugs: phase.input_phase_slugs.clone(),
        model_override: phase.model_override.clone(),
        agent_type: phase.agent_type.clone(),
    })
}

#[allow(clippy::too_many_arguments)]
pub async fn update_workflow_phase(
    pool: &SqlitePool,
    phase_id: i64,
    name: Option<&str>,
    gate_type: Option<&str>,
    system_prompt_template: Option<&str>,
    command_prompt_template: Option<&str>,
    artifact_template: Option<&str>,
    input_phase_slugs: Option<&Vec<String>>,
    model_override: Option<&str>,
    agent_type: Option<&str>,
) -> Result<WorkflowPhase, AppError> {
    let mut set_clauses: Vec<String> = Vec::new();
    let mut values: Vec<String> = Vec::new();

    let simple: &[(&str, Option<&str>)] = &[
        ("name = ?", name),
        ("gate_type = ?", gate_type),
        ("system_prompt_template = ?", system_prompt_template),
        ("command_prompt_template = ?", command_prompt_template),
        ("artifact_template = ?", artifact_template),
        ("model_override = ?", model_override),
        ("agent_type = ?", agent_type),
    ];
    for (clause, val) in simple {
        if let Some(v) = val { set_clauses.push((*clause).into()); values.push(v.to_string()); }
    }
    if let Some(v) = input_phase_slugs {
        set_clauses.push("input_phase_slugs = ?".into());
        values.push(serde_json::to_string(v).map_err(|e| AppError::Internal(e.to_string()))?);
    }

    if !set_clauses.is_empty() {
        let sql = format!(
            "UPDATE workflow_phases SET {} WHERE id = ?",
            set_clauses.join(", ")
        );
        let mut q = sqlx::query(&sql);
        for val in &values {
            q = q.bind(val);
        }
        q = q.bind(phase_id);
        q.execute(pool).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }

    let row = sqlx::query_as::<_, (i64, i64, String, String, i32, String, String, String, String, String, String, String)>(
        "SELECT id, workflow_definition_id, name, slug, order_index, gate_type, \
         system_prompt_template, command_prompt_template, artifact_template, \
         input_phase_slugs, model_override, agent_type \
         FROM workflow_phases WHERE id = ?"
    )
    .bind(phase_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?
    .ok_or_else(|| AppError::NotFound("Workflow phase not found".into()))?;

    let input_phase_slugs = parse_phase_slugs(&row.9, &row.2);
    Ok(WorkflowPhase {
        id: row.0, workflow_definition_id: row.1, name: row.2, slug: row.3,
        order_index: row.4, gate_type: row.5, system_prompt_template: row.6,
        command_prompt_template: row.7, artifact_template: row.8,
        input_phase_slugs, model_override: row.10, agent_type: row.11,
    })
}

pub async fn delete_workflow_phase(pool: &SqlitePool, phase_id: i64) -> Result<(), AppError> {
    sqlx::query("DELETE FROM workflow_phases WHERE id = ?")
        .bind(phase_id)
        .execute(pool)
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

pub async fn get_phase_definition_id(pool: &SqlitePool, phase_id: i64) -> Result<i64, AppError> {
    sqlx::query_scalar::<_, i64>(
        "SELECT workflow_definition_id FROM workflow_phases WHERE id = ?"
    )
    .bind(phase_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?
    .ok_or_else(|| AppError::NotFound("Workflow phase not found".into()))
}

pub async fn reorder_phases(
    pool: &SqlitePool,
    definition_id: i64,
    phase_ids_in_order: &[i64],
) -> Result<(), AppError> {
    let mut tx = pool.begin().await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    for (idx, phase_id) in phase_ids_in_order.iter().enumerate() {
        sqlx::query(
            "UPDATE workflow_phases SET order_index = ? WHERE id = ? AND workflow_definition_id = ?"
        )
        .bind(idx as i32)
        .bind(phase_id)
        .bind(definition_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    tx.commit().await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}
