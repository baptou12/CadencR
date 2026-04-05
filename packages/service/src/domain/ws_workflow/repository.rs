use std::collections::HashMap;
use sqlx::SqlitePool;

use crate::error::AppError;
use super::models::{
    CreateWorkflowDefinition, CreateWorkflowPhase, GateType,
    WorkflowDefinition, WorkflowPhase,
};
use super::phase_repository::{insert_phase, parse_phase_slugs};

async fn load_phases(pool: &SqlitePool, definition_id: i64) -> Result<Vec<WorkflowPhase>, AppError> {
    let rows = sqlx::query_as::<_, (i64, i64, String, String, i32, String, String, String, String, String, String, String, String)>(
        "SELECT id, workflow_definition_id, name, slug, order_index, gate_type, \
         system_prompt_template, command_prompt_template, artifact_template, \
         input_phase_slugs, model_override, agent_type, decompose_from \
         FROM workflow_phases WHERE workflow_definition_id = ? ORDER BY order_index"
    )
    .bind(definition_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(rows.into_iter().map(|r| {
        let input_phase_slugs = parse_phase_slugs(&r.9, &r.2);
        WorkflowPhase {
            id: r.0, workflow_definition_id: r.1, name: r.2, slug: r.3,
            order_index: r.4, gate_type: r.5, system_prompt_template: r.6,
            command_prompt_template: r.7, artifact_template: r.8,
            input_phase_slugs, model_override: r.10, agent_type: r.11,
            decompose_from: r.12,
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

    if rows.is_empty() {
        return Ok(vec![]);
    }

    let ids: Vec<i64> = rows.iter().map(|r| r.0).collect();
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let query = format!(
        "SELECT id, workflow_definition_id, name, slug, order_index, gate_type, \
         system_prompt_template, command_prompt_template, artifact_template, \
         input_phase_slugs, model_override, agent_type, decompose_from \
         FROM workflow_phases WHERE workflow_definition_id IN ({}) ORDER BY order_index",
        placeholders
    );

    let mut q = sqlx::query_as::<_, (i64, i64, String, String, i32, String, String, String, String, String, String, String, String)>(&query);
    for id in &ids {
        q = q.bind(id);
    }
    let phase_rows = q.fetch_all(pool).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut phases_map: HashMap<i64, Vec<WorkflowPhase>> = HashMap::new();
    for r in phase_rows {
        let input_phase_slugs = parse_phase_slugs(&r.9, &r.2);
        phases_map.entry(r.1).or_default().push(WorkflowPhase {
            id: r.0, workflow_definition_id: r.1, name: r.2, slug: r.3,
            order_index: r.4, gate_type: r.5, system_prompt_template: r.6,
            command_prompt_template: r.7, artifact_template: r.8,
            input_phase_slugs, model_override: r.10, agent_type: r.11,
            decompose_from: r.12,
        });
    }

    Ok(rows.into_iter().map(|row| {
        WorkflowDefinition {
            id: row.0, name: row.1, slug: row.2, description: row.3,
            is_preset: row.4, phases: phases_map.remove(&row.0).unwrap_or_default(),
            created_at: row.5, updated_at: row.6,
        }
    }).collect())
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

pub async fn update_workflow_definition(
    pool: &SqlitePool,
    id: i64,
    name: &str,
    description: Option<&str>,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE workflow_definitions SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?"
    )
    .bind(name)
    .bind(description)
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
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
            agent_type: p.agent_type,
            decompose_from: p.decompose_from,
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


