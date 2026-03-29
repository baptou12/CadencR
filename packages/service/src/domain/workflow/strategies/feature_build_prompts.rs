use serde_json;
use sqlx::SqlitePool;

use crate::domain::features::models::Phase;

use super::feature_build::PlanContext;

/// Format a completed phase entry with optional notes and deviations.
pub fn format_completed_phase(
    step: i64,
    title: &str,
    notes: Option<&str>,
    deviations: Option<&str>,
) -> String {
    let has_notes = notes.map_or(false, |n| !n.is_empty());
    let has_devs = deviations.map_or(false, |d| !d.is_empty());

    if !has_notes && !has_devs {
        return format!("- Step {step}: {title}");
    }

    let mut entry = format!("- **Step {step}: {title}**");
    if has_notes {
        entry.push_str(&format!("\n  - Notes: {}", notes.unwrap()));
    }
    if has_devs {
        entry.push_str(&format!("\n  - Deviations: {}", deviations.unwrap()));
    }
    entry
}

/// Build an enriched initial prompt for execute phases. Includes plan summary,
/// codebase context, clarifications, previously completed phases, and commit instructions.
pub async fn build_enriched_execute_prompt(
    read_pool: &SqlitePool,
    phase: &Phase,
    autonomy_level: u8,
    retry_count: i64,
) -> Result<String, String> {
    let plan: Option<PlanContext> = sqlx::query_as(
        "SELECT summary, context, clarifications FROM plans WHERE id = ?",
    )
    .bind(phase.plan_id)
    .fetch_optional(read_pool)
    .await
    .map_err(|e| format!("Failed to read plan: {e}"))?;

    let completed: Vec<(i64, String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT step_number, title, implementation_notes, deviations FROM phases WHERE plan_id = ? AND status = 'completed' AND step_number < ? ORDER BY step_number, order_index",
    )
    .bind(phase.plan_id)
    .bind(phase.step_number)
    .fetch_all(read_pool)
    .await
    .map_err(|e| format!("Failed to read completed phases: {e}"))?;

    let mut sections: Vec<String> = Vec::new();

    if retry_count > 0 {
        sections.push(format!(
            "## ⚠️ Resume Context\n\n\
             This phase was previously attempted ({retry_count} prior attempt(s)). Before starting:\n\
             1. Run `git status` and `git diff` to review any existing changes from the previous attempt\n\
             2. Assess whether the partial changes are salvageable or broken\n\
             3. If changes look correct and complete, verify them and continue to completion\n\
             4. If changes look partial but sound, continue from where the previous attempt left off\n\
             5. Only revert and start fresh if existing changes appear fundamentally broken\n\n\
             Do NOT redo work that was already correctly completed.",
            retry_count = retry_count,
        ));
    }

    if let Some(ref p) = plan {
        if let Some(ref s) = p.summary {
            if !s.is_empty() {
                sections.push(format!("## Plan Summary\n\n{s}"));
            }
        }
        if let Some(ref c) = p.context {
            if !c.is_empty() {
                sections.push(format!("## Codebase Context\n\n{c}"));
            }
        }
        if let Some(ref cl) = p.clarifications {
            if !cl.is_empty() {
                sections.push(format!("## Clarifications\n\n{cl}"));
            }
        }
    }

    if !completed.is_empty() {
        let list: String = completed
            .iter()
            .map(|(step, title, notes, devs)| {
                format_completed_phase(*step, title, notes.as_deref(), devs.as_deref())
            })
            .collect::<Vec<_>>()
            .join("\n");
        sections.push(format!(
            "## Previously Completed Phases\n\n\
             The following phases have already been implemented. Use the `read_phase` tool if you need details about a specific phase.\n\n{list}"
        ));
    }

    let phase_prompt = phase.prompt.as_deref().unwrap_or("");
    sections.push(format!(
        "## Current Phase: {title}\n\nPhase ID: {id}\n\n{phase_prompt}\n\n\
         Focus only on this phase's scope. Call `mark_phase_done` with phase_id={id} when complete.",
        title = phase.title,
        id = phase.id,
    ));

    let commit_msg = phase.commit_message.as_deref().unwrap_or("implement phase changes");
    let commit_instructions = format!(
        "To commit, stage ONLY the files you modified (do NOT use `git add -A` or `git add .` as other agents may be running in parallel). \
         Use `git add <file1> <file2> ...` for each file you changed, then:\n```\ngit commit -m {}\n```",
        serde_json::to_string(commit_msg).unwrap_or_else(|_| format!("\"{commit_msg}\""))
    );

    if autonomy_level == 1 {
        sections.push(format!(
            "## User Approval Required\n\n\
             After outputting your implementation notes and deviations, you MUST ask the user for approval using AskUserQuestion:\n\n\
             - Question: \"Review complete. Approve changes and commit?\"\n\
             - Options: \"Approve and commit\", \"Skip commit\", \"Request changes\"\n\n\
             If the user selects \"Request changes\", they will provide feedback via the \"Other\" option. In that case:\n\
             1. Read and address their feedback\n\
             2. Make the necessary fixes\n\
             3. Re-output your updated implementation notes and deviations\n\
             4. Ask for approval again\n\n\
             If the user selects \"Approve and commit\":\n{commit_instructions}\n\n\
             Then call `mark_phase_done` with your implementation notes and deviations.\n\n\
             **Do NOT call `mark_phase_done` until after approval and successful commit.**\n\n\
             If the user selects \"Skip commit\", do NOT commit.\n\n\
             Repeat the approval loop until the user approves or skips. \
             Only call `mark_agent_done` after the user has approved or skipped."
        ));
    } else {
        sections.push(format!(
            "## Auto-Commit\n\nAfter completing your implementation, automatically commit your changes:\n{commit_instructions}\n\n\
             After committing, call `mark_phase_done` with your implementation notes and deviations. \
             **Do NOT call `mark_phase_done` before committing.**\n\nThen call `mark_agent_done`."
        ));
    }

    Ok(sections.join("\n\n---\n\n"))
}

/// Build an enriched initial prompt for QA phases.
pub async fn build_enriched_qa_prompt(
    read_pool: &SqlitePool,
    phase: &Phase,
    feature_id: i64,
) -> Result<String, String> {
    let qa_prompt: String = sqlx::query_scalar::<_, Option<String>>(
        "SELECT p.qa_prompt FROM projects p JOIN features f ON f.project_id = p.id WHERE f.id = ?",
    )
    .bind(feature_id)
    .fetch_optional(read_pool)
    .await
    .map_err(|e| format!("Failed to read QA prompt: {e}"))?
    .flatten()
    .unwrap_or_else(|| {
        "Run any available tests and verify the implementation works correctly.".to_string()
    });

    let completed: Vec<(i64, String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT step_number, title, implementation_notes, deviations FROM phases WHERE plan_id = ? AND status = 'completed' ORDER BY step_number, order_index",
    )
    .bind(phase.plan_id)
    .fetch_all(read_pool)
    .await
    .map_err(|e| format!("Failed to read completed phases: {e}"))?;

    let completed_summary = if completed.is_empty() {
        "No phases have been completed yet.".to_string()
    } else {
        let list: String = completed
            .iter()
            .map(|(step, title, notes, devs)| {
                format_completed_phase(*step, title, notes.as_deref(), devs.as_deref())
            })
            .collect::<Vec<_>>()
            .join("\n");
        format!("The following phases have been completed:\n\n{list}")
    };

    let pending_non_qa: Option<(i64,)> = sqlx::query_as(
        "SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND (phase_type IS NULL OR phase_type != 'qa') AND status != 'completed'",
    )
    .bind(phase.plan_id)
    .fetch_optional(read_pool)
    .await
    .map_err(|e| format!("Failed to check pending phases: {e}"))?;

    let mut prd_section = String::new();
    if pending_non_qa.map_or(false, |(cnt,)| cnt == 0) {
        let prd: Option<(Option<String>,)> =
            sqlx::query_as("SELECT prd FROM features WHERE id = ?")
                .bind(feature_id)
                .fetch_optional(read_pool)
                .await
                .map_err(|e| format!("Failed to read PRD: {e}"))?;

        if let Some((Some(ref content),)) = prd {
            if !content.is_empty() {
                prd_section = format!(
                    "## Product Requirements Document (PRD)\n\n\
                     The following PRD defines the functional and business requirements. \
                     Verify that the implementation satisfies ALL requirements listed here:\n\n{content}\n\n"
                );
            }
        }
    }

    let max_step: Option<(i64,)> = sqlx::query_as(
        "SELECT MAX(step_number) FROM phases WHERE plan_id = ?",
    )
    .bind(phase.plan_id)
    .fetch_optional(read_pool)
    .await
    .map_err(|e| format!("Failed to get max step: {e}"))?;
    let fix_step = max_step.map_or(phase.step_number + 1, |(s,)| s + 1);

    Ok(format!(
        "{prd_section}## What was implemented\n\n\
         {completed_summary}\n\n\
         ## QA Testing Procedure\n\n\
         The following procedure describes HOW to validate the implementation (tools, simulators, MCPs, commands, etc.):\n\n\
         {qa_prompt}\n\n\
         The plan ID is {plan_id}. Your phase ID is {phase_id}. \
         If you find failures that need fixes, use the MCP tools to create fix phases starting at step_number {fix_step}, \
         then create a follow-up QA phase (type \"qa\") at the next step_number after all fix phases.\n\n\
         Based on what was implemented above, design specific test cases and execute them using the QA procedure. \
         Verify that the features work correctly from a user's perspective.",
        plan_id = phase.plan_id,
        phase_id = phase.id,
    ))
}

