use sqlx::SqlitePool;

use crate::domain::workflow::prompts::{
    constitution_section, fetch_project_constitution,
};

use super::feature_build_prompts::format_completed_phase;

/// Build an enriched initial prompt for session agents with plan state and constitution.
pub async fn build_session_prompt(
    read_pool: &SqlitePool,
    feature_id: i64,
    user_prompt: &str,
) -> Result<String, String> {
    let mut sections: Vec<String> = Vec::new();

    let constitution = fetch_project_constitution(read_pool, feature_id).await?;
    if let Some(ref c) = constitution {
        let s = constitution_section(c);
        if !s.is_empty() {
            sections.push(s);
        }
    }

    let plan: Option<(i64, Option<String>)> = sqlx::query_as(
        "SELECT id, summary FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1",
    )
    .bind(feature_id)
    .fetch_optional(read_pool)
    .await
    .map_err(|e| format!("Failed to read plan: {e}"))?;

    if let Some((plan_id, summary)) = plan {
        let phases: Vec<(i64, String, String)> = sqlx::query_as(
            "SELECT step_number, title, status FROM phases WHERE plan_id = ? ORDER BY step_number, order_index",
        )
        .bind(plan_id)
        .fetch_all(read_pool)
        .await
        .map_err(|e| format!("Failed to read phases: {e}"))?;

        if !phases.is_empty() {
            let summary_text = summary
                .filter(|s| !s.is_empty())
                .map(|s| format!("**Summary:** {s}\n\n"))
                .unwrap_or_default();

            let phase_list: String = phases
                .iter()
                .map(|(step, title, status)| {
                    let icon = match status.as_str() {
                        "completed" => "✅ Completed",
                        "running" => "🔄 Running",
                        _ => "⏳ Pending",
                    };
                    format!("- Step {step}: {title} — {icon}")
                })
                .collect::<Vec<_>>()
                .join("\n");

            sections.push(format!(
                "## Current Plan State\n{summary_text}**Phases:**\n{phase_list}"
            ));
        }
    }

    let feature: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT title, prd FROM features WHERE id = ?")
            .bind(feature_id)
            .fetch_optional(read_pool)
            .await
            .unwrap_or(None);

    let mut ctx_parts = vec![format!("## Feature Context\n\n**Feature ID:** {feature_id}")];
    if let Some((title, prd)) = feature {
        ctx_parts.push(format!("**Title:** {title}"));
        if let Some(desc) = prd.filter(|s| !s.is_empty()) {
            ctx_parts.push(format!("**Description:**\n{desc}"));
        }
    }
    sections.push(ctx_parts.join("\n\n"));

    sections.push(format!("---\n\n{user_prompt}"));

    Ok(sections.join("\n\n"))
}

/// Build an enriched initial prompt for the review agent.
pub async fn build_enriched_review_prompt(
    read_pool: &SqlitePool,
    feature_id: i64,
    feature_title: &str,
) -> Result<String, String> {
    let plan: Option<(i64, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT id, summary, context, clarifications FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1",
    )
    .bind(feature_id)
    .fetch_optional(read_pool)
    .await
    .map_err(|e| format!("Failed to read plan: {e}"))?;

    let constitution = fetch_project_constitution(read_pool, feature_id).await?;
    let mut sections: Vec<String> = Vec::new();

    if let Some(ref c) = constitution {
        let s = constitution_section(c);
        if !s.is_empty() {
            sections.push(s);
        }
    }

    let prd: Option<(Option<String>,)> =
        sqlx::query_as("SELECT prd FROM features WHERE id = ?")
            .bind(feature_id)
            .fetch_optional(read_pool)
            .await
            .map_err(|e| format!("Failed to read PRD: {e}"))?;

    if let Some((Some(ref content),)) = prd {
        if !content.is_empty() {
            sections.push(format!("## Product Requirements\n\n{content}"));
        }
    }

    let plan_id = if let Some((pid, ref summary, ref context, ref clarifications)) = plan {
        if let Some(s) = summary {
            if !s.is_empty() {
                sections.push(format!("## Plan Summary\n\n{s}"));
            }
        }
        if let Some(c) = context {
            if !c.is_empty() {
                sections.push(format!("## Codebase Context\n\n{c}"));
            }
        }
        if let Some(cl) = clarifications {
            if !cl.is_empty() {
                sections.push(format!("## Clarifications\n\n{cl}"));
            }
        }
        pid
    } else {
        0
    };

    if plan_id > 0 {
        let completed: Vec<(i64, String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT step_number, title, implementation_notes, deviations FROM phases WHERE plan_id = ? AND status = 'completed' ORDER BY step_number, order_index",
        )
        .bind(plan_id)
        .fetch_all(read_pool)
        .await
        .map_err(|e| format!("Failed to read completed phases: {e}"))?;

        if !completed.is_empty() {
            let list: String = completed
                .iter()
                .map(|(step, title, notes, devs)| {
                    format_completed_phase(*step, title, notes.as_deref(), devs.as_deref())
                })
                .collect::<Vec<_>>()
                .join("\n");
            sections.push(format!(
                "## Completed Phases\n\n\
                 The following phases were implemented. Use the `read_phase` tool via `list_phases` if you need details about a specific phase.\n\n{list}"
            ));
        }
    }

    sections.push(format!(
        "## Instructions\n\n\
         **Plan ID: {plan_id}** — Use this ID when calling MCP tools like `read_plan`, `list_phases`, `create_phase`, `finalize_phases`, etc.\n\n\
         Review the implementation of feature \"{feature_title}\" against the specification above. \
         Ask yourself: \"If I had to build this from the spec, how should the code look?\" Then compare with the actual changes.\n\n\
         Start by running `git diff` and `git diff --cached` to see all changes. Review each change carefully and produce a detailed review report.\n\n\
         You have MCP tools available (prefixed with mcp__cadence-review__) to create fix phases if changes are needed. \
         Follow the completion instructions in your system prompt to finalize your review."
    ));

    Ok(sections.join("\n\n---\n\n"))
}
