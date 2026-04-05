use std::collections::HashMap;

use chrono::Local;
use sqlx::SqlitePool;

use crate::error::AppError;
use super::models::{WorkflowDefinition, WorkflowPhase};
use super::artifact_repository;

pub struct TemplateContext {
    pub feature_title: String,
    pub feature_description: String,
    pub project_name: String,
    pub project_path: String,
    pub phase_name: String,
    pub prior_artifacts: String,
    pub phase_artifacts: HashMap<String, String>,
    pub date: String,
}

/// Replace `{{variable}}` placeholders with values from context.
/// Unknown variables are left as-is.
pub fn interpolate(template: &str, ctx: &TemplateContext) -> String {
    let built_ins: Vec<(&str, &str)> = vec![
        ("feature_title", &ctx.feature_title),
        ("feature_description", &ctx.feature_description),
        ("project_name", &ctx.project_name),
        ("project_path", &ctx.project_path),
        ("phase_name", &ctx.phase_name),
        ("prior_artifacts", &ctx.prior_artifacts),
        ("date", &ctx.date),
    ];

    let mut result = template.to_string();

    for (key, value) in &built_ins {
        let placeholder = format!("{{{{{}}}}}", key);
        result = result.replace(&placeholder, value);
    }

    // Handle {{artifact:slug}} patterns
    for (slug, content) in &ctx.phase_artifacts {
        let placeholder = format!("{{{{artifact:{}}}}}", slug);
        result = result.replace(&placeholder, content);
    }

    result
}

/// Build a TemplateContext by loading feature, project, and prior artifacts from DB.
pub async fn build_template_context(
    pool: &SqlitePool,
    feature_id: i64,
    phase: &WorkflowPhase,
    _definition: &WorkflowDefinition,
) -> Result<TemplateContext, AppError> {
    let feature = sqlx::query_as::<_, (String, i64, Option<String>)>(
        "SELECT title, project_id, prd FROM features WHERE id = ?",
    )
    .bind(feature_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?
    .ok_or_else(|| AppError::NotFound(format!("Feature {} not found", feature_id)))?;

    let (feature_title, project_id, prd) = feature;

    let project = sqlx::query_as::<_, (String, String)>(
        "SELECT name, path FROM projects WHERE id = ?",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?
    .ok_or_else(|| AppError::NotFound(format!("Project {} not found", project_id)))?;

    let (project_name, project_path) = project;

    // Load all artifacts for this feature once, then derive both prior_artifacts and phase_artifacts map.
    let all_artifacts = artifact_repository::get_artifacts_for_feature(pool, feature_id).await?;

    // Group artifacts by phase_slug for lookup
    let mut by_slug: HashMap<String, Vec<&super::models::WorkflowArtifact>> = HashMap::new();
    for a in &all_artifacts {
        by_slug.entry(a.phase_slug.clone()).or_default().push(a);
    }

    // Build prior_artifacts from input_phase_slugs
    let mut prior_parts = Vec::new();
    for slug in &phase.input_phase_slugs {
        if let Some(phase_arts) = by_slug.get(slug.as_str()) {
            let owned: Vec<super::models::WorkflowArtifact> = phase_arts.iter().map(|a| (*a).clone()).collect();
            if let Some(formatted) = artifact_repository::format_artifacts(&owned, Some(slug)) {
                prior_parts.push(formatted);
            }
        }
    }
    let prior_artifacts = prior_parts.join("\n\n---\n\n");

    // Build phase_artifacts map: "slug" → default content, "slug/type" → typed content.
    let mut phase_artifacts: HashMap<String, String> = HashMap::new();
    for a in &all_artifacts {
        phase_artifacts.insert(format!("{}/{}", a.phase_slug, a.artifact_type), a.content.clone());
        if a.artifact_type == super::models::DEFAULT_ARTIFACT_TYPE || !phase_artifacts.contains_key(&a.phase_slug) {
            phase_artifacts.insert(a.phase_slug.clone(), a.content.clone());
        }
    }

    Ok(TemplateContext {
        feature_title,
        feature_description: prd.unwrap_or_default(),
        project_name,
        project_path,
        phase_name: phase.name.clone(),
        prior_artifacts,
        phase_artifacts,
        date: Local::now().format("%Y-%m-%d").to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_ctx() -> TemplateContext {
        let mut phase_artifacts = HashMap::new();
        phase_artifacts.insert("prd".to_string(), "PRD content here".to_string());

        TemplateContext {
            feature_title: "My Feature".to_string(),
            feature_description: "A cool feature".to_string(),
            project_name: "TestProject".to_string(),
            project_path: "/tmp/test".to_string(),
            phase_name: "Planning".to_string(),
            prior_artifacts: "Prior stuff".to_string(),
            phase_artifacts,
            date: "2025-01-01".to_string(),
        }
    }

    #[test]
    fn test_interpolate_built_ins() {
        let ctx = test_ctx();
        let result = interpolate("Title: {{feature_title}}, Phase: {{phase_name}}", &ctx);
        assert_eq!(result, "Title: My Feature, Phase: Planning");
    }

    #[test]
    fn test_interpolate_artifact() {
        let ctx = test_ctx();
        let result = interpolate("See: {{artifact:prd}}", &ctx);
        assert_eq!(result, "See: PRD content here");
    }

    #[test]
    fn test_interpolate_unknown_preserved() {
        let ctx = test_ctx();
        let result = interpolate("{{unknown_var}} stays", &ctx);
        assert_eq!(result, "{{unknown_var}} stays");
    }

    #[test]
    fn test_interpolate_missing_artifact_preserved() {
        let ctx = test_ctx();
        let result = interpolate("{{artifact:missing}}", &ctx);
        assert_eq!(result, "{{artifact:missing}}");
    }

    #[test]
    fn test_interpolate_typed_artifact() {
        let mut ctx = test_ctx();
        ctx.phase_artifacts.insert("propose/specs".to_string(), "Specs content".to_string());
        ctx.phase_artifacts.insert("propose/design".to_string(), "Design content".to_string());

        let result = interpolate("Specs: {{artifact:propose/specs}}, Design: {{artifact:propose/design}}", &ctx);
        assert_eq!(result, "Specs: Specs content, Design: Design content");

        // Plain slug still works for default
        ctx.phase_artifacts.insert("propose".to_string(), "Default propose content".to_string());
        let result = interpolate("{{artifact:propose}}", &ctx);
        assert_eq!(result, "Default propose content");
    }
}
