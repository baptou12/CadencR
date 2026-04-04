use sqlx::SqlitePool;

use crate::error::AppError;
use super::models::{
    CreateWorkflowDefinition, CreateWorkflowPhase, GateType,
    WorkflowDefinition, WorkflowPhase,
};

async fn load_phases(pool: &SqlitePool, definition_id: i64) -> Result<Vec<WorkflowPhase>, AppError> {
    let rows = sqlx::query_as::<_, (i64, i64, String, String, i32, String, String, String, String, String, String)>(
        "SELECT id, workflow_definition_id, name, slug, order_index, gate_type, \
         system_prompt_template, command_prompt_template, artifact_template, \
         input_phase_slugs, model_override \
         FROM workflow_phases WHERE workflow_definition_id = ? ORDER BY order_index"
    )
    .bind(definition_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(rows.into_iter().map(|r| {
        let input_phase_slugs: Vec<String> = serde_json::from_str(&r.9).unwrap_or_default();
        WorkflowPhase {
            id: r.0, workflow_definition_id: r.1, name: r.2, slug: r.3,
            order_index: r.4, gate_type: r.5, system_prompt_template: r.6,
            command_prompt_template: r.7, artifact_template: r.8,
            input_phase_slugs, model_override: r.10,
        }
    }).collect())
}

async fn build_definition(
    pool: &SqlitePool,
    row: (i64, String, String, Option<String>, bool, String, String),
) -> Result<WorkflowDefinition, AppError> {
    let phases = load_phases(pool, row.0).await?;
    Ok(WorkflowDefinition {
        id: row.0, name: row.1, slug: row.2, description: row.3,
        is_preset: row.4, phases, created_at: row.5, updated_at: row.6,
    })
}

const DEF_SELECT: &str = "SELECT id, name, slug, description, is_preset, created_at, updated_at FROM workflow_definitions";

pub async fn list_workflow_definitions(pool: &SqlitePool) -> Result<Vec<WorkflowDefinition>, AppError> {
    let rows = sqlx::query_as::<_, (i64, String, String, Option<String>, bool, String, String)>(
        &format!("{} ORDER BY created_at", DEF_SELECT),
    )
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut defs = Vec::with_capacity(rows.len());
    for row in rows {
        defs.push(build_definition(pool, row).await?);
    }
    Ok(defs)
}

pub async fn get_workflow_definition(pool: &SqlitePool, id: i64) -> Result<Option<WorkflowDefinition>, AppError> {
    let row = sqlx::query_as::<_, (i64, String, String, Option<String>, bool, String, String)>(
        &format!("{} WHERE id = ?", DEF_SELECT),
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    match row {
        Some(r) => Ok(Some(build_definition(pool, r).await?)),
        None => Ok(None),
    }
}

pub async fn get_workflow_definition_by_slug(pool: &SqlitePool, slug: &str) -> Result<Option<WorkflowDefinition>, AppError> {
    let row = sqlx::query_as::<_, (i64, String, String, Option<String>, bool, String, String)>(
        &format!("{} WHERE slug = ?", DEF_SELECT),
    )
    .bind(slug)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    match row {
        Some(r) => Ok(Some(build_definition(pool, r).await?)),
        None => Ok(None),
    }
}

pub async fn create_workflow_definition(
    pool: &SqlitePool,
    input: CreateWorkflowDefinition,
) -> Result<WorkflowDefinition, AppError> {
    let id = sqlx::query(
        "INSERT INTO workflow_definitions (name, slug, description, is_preset) VALUES (?, ?, ?, ?)"
    )
    .bind(&input.name)
    .bind(&input.slug)
    .bind(&input.description)
    .bind(input.is_preset)
    .execute(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?
    .last_insert_rowid();

    for phase in &input.phases {
        insert_phase(pool, id, phase).await?;
    }

    get_workflow_definition(pool, id)
        .await?
        .ok_or_else(|| AppError::Internal("Failed to read back created definition".into()))
}

async fn insert_phase(
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
          input_phase_slugs, model_override) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
    .execute(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?
    .last_insert_rowid();

    Ok(id)
}

pub async fn update_workflow_definition(
    pool: &SqlitePool,
    id: i64,
    name: &str,
    description: Option<&str>,
) -> Result<WorkflowDefinition, AppError> {
    sqlx::query(
        "UPDATE workflow_definitions SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?"
    )
    .bind(name)
    .bind(description)
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    get_workflow_definition(pool, id)
        .await?
        .ok_or_else(|| AppError::NotFound("Workflow definition not found".into()))
}

pub async fn delete_workflow_definition(pool: &SqlitePool, id: i64) -> Result<(), AppError> {
    // Block deletion if in-progress features reference this definition
    let count = sqlx::query_as::<_, (i64,)>(
        "SELECT COUNT(*) FROM features WHERE workflow_definition_id = ? AND status NOT IN ('done', 'cancelled')"
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?
    .0;

    if count > 0 {
        return Err(AppError::BadRequest(
            "Cannot delete workflow definition: in-progress features reference it".into(),
        ));
    }

    sqlx::query("DELETE FROM workflow_phases WHERE workflow_definition_id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    sqlx::query("DELETE FROM workflow_definitions WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

pub async fn fork_workflow_definition(
    pool: &SqlitePool,
    source_id: i64,
    new_name: &str,
    new_slug: &str,
) -> Result<WorkflowDefinition, AppError> {
    let source = get_workflow_definition(pool, source_id)
        .await?
        .ok_or_else(|| AppError::NotFound("Source workflow definition not found".into()))?;

    let phases: Vec<CreateWorkflowPhase> = source.phases.into_iter().map(|p| {
        CreateWorkflowPhase {
            name: p.name,
            slug: p.slug,
            order_index: p.order_index,
            gate_type: p.gate_type.parse::<GateType>().unwrap_or(GateType::Auto),
            system_prompt_template: p.system_prompt_template,
            command_prompt_template: p.command_prompt_template,
            artifact_template: p.artifact_template,
            input_phase_slugs: p.input_phase_slugs,
            model_override: p.model_override,
        }
    }).collect();

    create_workflow_definition(pool, CreateWorkflowDefinition {
        name: new_name.to_string(),
        slug: new_slug.to_string(),
        description: source.description,
        is_preset: false,
        phases,
    }).await
}

pub async fn create_workflow_phase(
    pool: &SqlitePool,
    definition_id: i64,
    phase: &CreateWorkflowPhase,
) -> Result<WorkflowPhase, AppError> {
    let id = insert_phase(pool, definition_id, phase).await?;
    let slugs_json = serde_json::to_string(&phase.input_phase_slugs)
        .map_err(|e| AppError::Internal(e.to_string()))?;

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
        input_phase_slugs: serde_json::from_str(&slugs_json).unwrap_or_default(),
        model_override: phase.model_override.clone(),
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
) -> Result<WorkflowPhase, AppError> {
    if let Some(v) = name {
        sqlx::query("UPDATE workflow_phases SET name = ? WHERE id = ?").bind(v).bind(phase_id)
            .execute(pool).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = gate_type {
        sqlx::query("UPDATE workflow_phases SET gate_type = ? WHERE id = ?").bind(v).bind(phase_id)
            .execute(pool).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = system_prompt_template {
        sqlx::query("UPDATE workflow_phases SET system_prompt_template = ? WHERE id = ?").bind(v).bind(phase_id)
            .execute(pool).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = command_prompt_template {
        sqlx::query("UPDATE workflow_phases SET command_prompt_template = ? WHERE id = ?").bind(v).bind(phase_id)
            .execute(pool).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = artifact_template {
        sqlx::query("UPDATE workflow_phases SET artifact_template = ? WHERE id = ?").bind(v).bind(phase_id)
            .execute(pool).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = input_phase_slugs {
        let json = serde_json::to_string(v).map_err(|e| AppError::Internal(e.to_string()))?;
        sqlx::query("UPDATE workflow_phases SET input_phase_slugs = ? WHERE id = ?").bind(&json).bind(phase_id)
            .execute(pool).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = model_override {
        sqlx::query("UPDATE workflow_phases SET model_override = ? WHERE id = ?").bind(v).bind(phase_id)
            .execute(pool).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }

    let row = sqlx::query_as::<_, (i64, i64, String, String, i32, String, String, String, String, String, String)>(
        "SELECT id, workflow_definition_id, name, slug, order_index, gate_type, \
         system_prompt_template, command_prompt_template, artifact_template, \
         input_phase_slugs, model_override \
         FROM workflow_phases WHERE id = ?"
    )
    .bind(phase_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?
    .ok_or_else(|| AppError::NotFound("Workflow phase not found".into()))?;

    Ok(WorkflowPhase {
        id: row.0, workflow_definition_id: row.1, name: row.2, slug: row.3,
        order_index: row.4, gate_type: row.5, system_prompt_template: row.6,
        command_prompt_template: row.7, artifact_template: row.8,
        input_phase_slugs: serde_json::from_str(&row.9).unwrap_or_default(),
        model_override: row.10,
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

pub async fn reorder_phases(
    pool: &SqlitePool,
    definition_id: i64,
    phase_ids_in_order: &[i64],
) -> Result<(), AppError> {
    for (idx, phase_id) in phase_ids_in_order.iter().enumerate() {
        sqlx::query(
            "UPDATE workflow_phases SET order_index = ? WHERE id = ? AND workflow_definition_id = ?"
        )
        .bind(idx as i32)
        .bind(phase_id)
        .bind(definition_id)
        .execute(pool)
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    Ok(())
}

