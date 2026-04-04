use std::collections::HashMap;
use sqlx::SqlitePool;

use crate::error::AppError;
use super::models::{
    CreateWorkflowDefinition, CreateWorkflowPhase, GateType,
    WorkflowDefinition, WorkflowPhase,
};

fn parse_phase_slugs(json: &str, phase_name: &str) -> Vec<String> {
    serde_json::from_str(json).unwrap_or_else(|e| {
        tracing::warn!("Malformed input_phase_slugs JSON for phase {}: {}", phase_name, e);
        vec![]
    })
}

async fn load_phases(pool: &SqlitePool, definition_id: i64) -> Result<Vec<WorkflowPhase>, AppError> {
    let rows = sqlx::query_as::<_, (i64, i64, String, String, i32, String, String, String, String, String, String, String)>(
        "SELECT id, workflow_definition_id, name, slug, order_index, gate_type, \
         system_prompt_template, command_prompt_template, artifact_template, \
         input_phase_slugs, model_override, agent_type \
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
         input_phase_slugs, model_override, agent_type \
         FROM workflow_phases WHERE workflow_definition_id IN ({}) ORDER BY order_index",
        placeholders
    );

    let mut q = sqlx::query_as::<_, (i64, i64, String, String, i32, String, String, String, String, String, String, String)>(&query);
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
            agent_type: p.agent_type,
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
    // Build a single dynamic UPDATE with all provided fields
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

