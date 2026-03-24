use serde_json;
use std::collections::HashMap;

use async_trait::async_trait;
use sqlx::SqlitePool;

use crate::domain::features::models::{Phase, QueueItem, WorkflowType};
use crate::domain::features::repository;
use crate::domain::mcp::servers::AgentType;
use crate::domain::workflow::populate::topological_sort;
use crate::domain::workflow::prompts::{build_execute_prompt, build_qa_prompt, build_review_prompt};

use super::WorkflowStrategy;

/// Parse a `depends_on` string that may be a JSON array (e.g. `["A", "B"]`) or comma-separated titles.
fn parse_depends_on(raw: &str) -> Vec<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return vec![];
    }
    // Try JSON array first
    if let Ok(titles) = serde_json::from_str::<Vec<String>>(trimmed) {
        return titles;
    }
    // Fall back to comma-separated
    trimmed
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Lightweight plan context for enriching prompts (subset of Plan fields).
#[derive(sqlx::FromRow)]
struct PlanContext {
    summary: Option<String>,
    context: Option<String>,
    clarifications: Option<String>,
}

pub struct FeatureBuildStrategy;

#[async_trait]
impl WorkflowStrategy for FeatureBuildStrategy {
    fn workflow_type(&self) -> WorkflowType {
        WorkflowType::FeatureBuild
    }

    async fn populate_queue(
        &self,
        write_pool: &SqlitePool,
        read_pool: &SqlitePool,
        feature_id: i64,
        plan_id: Option<i64>,
    ) -> Result<Vec<QueueItem>, String> {
        let plan_id = plan_id.ok_or("FeatureBuild requires a plan_id")?;

        // 1. Clear existing queue (idempotent)
        repository::clear_queue_for_feature(write_pool, feature_id)
            .await
            .map_err(|e| format!("Failed to clear queue: {e}"))?;

        // 2. Read all phases for the plan
        let phases: Vec<Phase> = sqlx::query_as(
            "SELECT * FROM phases WHERE plan_id = ? ORDER BY order_index, step_number",
        )
        .bind(plan_id)
        .fetch_all(read_pool)
        .await
        .map_err(|e| format!("Failed to read phases: {e}"))?;

        if phases.is_empty() {
            return Ok(vec![]);
        }

        // 3. Build title -> phase map for resolving depends_on references
        let title_to_phase: HashMap<String, &Phase> = phases
            .iter()
            .map(|p| (p.title.clone(), p))
            .collect();

        let phase_ids: Vec<i64> = phases.iter().map(|p| p.id).collect();

        // 4. Resolve depends_on title references to edges
        let mut edges: Vec<(i64, i64)> = Vec::new();
        for phase in &phases {
            if let Some(ref deps_str) = phase.depends_on {
                for dep_title in parse_depends_on(deps_str) {
                    let dep_phase = title_to_phase.get(dep_title.as_str()).ok_or_else(|| {
                        format!(
                            "Phase '{}' depends on '{}' which does not exist in plan",
                            phase.title, dep_title
                        )
                    })?;
                    edges.push((dep_phase.id, phase.id));
                }
            }
        }

        // 5. Topological sort with group indices
        let sorted = topological_sort(&phase_ids, &edges)?;
        let id_to_group: HashMap<i64, usize> = sorted.iter().copied().collect();
        let id_to_order: HashMap<i64, usize> = sorted
            .iter()
            .enumerate()
            .map(|(i, &(id, _))| (id, i))
            .collect();

        // 6. Insert queue items
        let workflow_type_str = WorkflowType::FeatureBuild.as_str();
        let mut phase_to_queue_item: HashMap<i64, i64> = HashMap::new();

        for phase in &phases {
            let order_index = *id_to_order.get(&phase.id).unwrap_or(&0) as i64;
            let group_index = *id_to_group.get(&phase.id).unwrap_or(&0) as i64;

            let item_type = map_phase_type_to_item_type(phase.phase_type.as_deref());
            let has_deps = phase.depends_on.as_ref().map_or(false, |d| !parse_depends_on(d).is_empty());
            let status = if has_deps { "blocked" } else { "ready" };

            let queue_id = repository::insert_queue_item(
                write_pool,
                feature_id,
                workflow_type_str,
                item_type,
                Some(phase.id),
                status,
                order_index,
                Some(group_index),
            )
            .await
            .map_err(|e| format!("Failed to insert queue item: {e}"))?;

            phase_to_queue_item.insert(phase.id, queue_id);
        }

        // 7. Insert dependency edges
        for phase in &phases {
            if let Some(ref deps_str) = phase.depends_on {
                for dep_title in parse_depends_on(deps_str) {
                    if let Some(dep_phase) = title_to_phase.get(dep_title.as_str()) {
                        let queue_item_id = phase_to_queue_item[&phase.id];
                        let depends_on_item_id = phase_to_queue_item[&dep_phase.id];
                        repository::insert_dependency(write_pool, queue_item_id, depends_on_item_id)
                            .await
                            .map_err(|e| format!("Failed to insert dependency: {e}"))?;
                    }
                }
            }
        }

        // 8. Append built-in review item (depends on all phase items)
        let max_order = sorted.len() as i64;
        let max_group = sorted.iter().map(|&(_, g)| g).max().unwrap_or(0) as i64 + 1;
        let all_queue_ids: Vec<i64> = phase_to_queue_item.values().copied().collect();

        let review_id = repository::insert_queue_item(
            write_pool,
            feature_id,
            workflow_type_str,
            "review",
            None,
            "blocked",
            max_order,
            Some(max_group),
        )
        .await
        .map_err(|e| format!("Failed to insert review item: {e}"))?;

        for &dep_id in &all_queue_ids {
            repository::insert_dependency(write_pool, review_id, dep_id)
                .await
                .map_err(|e| format!("Failed to insert review dependency: {e}"))?;
        }

        // 9. Return the full queue
        let items = repository::get_queue_for_feature(read_pool, feature_id)
            .await
            .map_err(|e| format!("Failed to read queue: {e}"))?;

        Ok(items)
    }

    fn agent_type_for_item(&self, item_type: &str) -> Result<AgentType, String> {
        match item_type {
            "execute" => Ok(AgentType::Execute),
            "qa" => Ok(AgentType::Qa),
            "review" => Ok(AgentType::Review),
            "risk" => Ok(AgentType::Risk),
            "retro" => Ok(AgentType::Retro),
            other => Err(format!("Unknown item type for FeatureBuild: {other}")),
        }
    }

    async fn build_system_prompt(
        &self,
        read_pool: &SqlitePool,
        item: &QueueItem,
        autonomy_level: u8,
    ) -> Result<String, String> {
        match item.item_type.as_str() {
            "execute" | "qa" => {
                let phase = self.read_phase(read_pool, item.phase_id).await?;
                if item.item_type == "execute" {
                    Ok(build_execute_prompt(
                        &phase.title,
                        phase.prompt.as_deref().unwrap_or(""),
                        phase.commit_message.as_deref().unwrap_or(""),
                        autonomy_level,
                    ))
                } else {
                    Ok(build_qa_prompt(
                        &phase.title,
                        phase.prompt.as_deref().unwrap_or(""),
                        autonomy_level,
                    ))
                }
            }
            "review" => Ok(build_review_prompt(autonomy_level)),
            other => Err(format!("Unknown item type for system prompt: {other}")),
        }
    }

    async fn build_initial_prompt(
        &self,
        read_pool: &SqlitePool,
        item: &QueueItem,
        feature_title: &str,
        autonomy_level: u8,
    ) -> Result<String, String> {
        match item.item_type.as_str() {
            "execute" => {
                let phase = self.read_phase(read_pool, item.phase_id).await?;
                self.build_enriched_execute_prompt(read_pool, &phase, autonomy_level).await
            }
            "qa" => {
                let phase = self.read_phase(read_pool, item.phase_id).await?;
                self.build_enriched_qa_prompt(read_pool, &phase, item.feature_id).await
            }
            "review" => {
                self.build_enriched_review_prompt(read_pool, item.feature_id, feature_title).await
            }
            other => Err(format!("Unknown item type for initial prompt: {other}")),
        }
    }
}

impl FeatureBuildStrategy {
    async fn read_phase(&self, read_pool: &SqlitePool, phase_id: Option<i64>) -> Result<Phase, String> {
        let phase_id = phase_id.ok_or("Queue item requires a phase_id but none was set")?;
        sqlx::query_as::<_, Phase>("SELECT * FROM phases WHERE id = ?")
            .bind(phase_id)
            .fetch_optional(read_pool)
            .await
            .map_err(|e| format!("Failed to read phase: {e}"))?
            .ok_or_else(|| format!("Phase {phase_id} not found"))
    }

    /// Build an enriched initial prompt for execute phases, matching the legacy
    /// `buildEnrichedPrompt()` from TypeScript. Includes plan summary, codebase
    /// context, clarifications, previously completed phases, and commit instructions.
    async fn build_enriched_execute_prompt(
        &self,
        read_pool: &SqlitePool,
        phase: &Phase,
        autonomy_level: u8,
    ) -> Result<String, String> {
        // Fetch plan-level context
        let plan: Option<PlanContext> = sqlx::query_as(
            "SELECT summary, context, clarifications FROM plans WHERE id = ?",
        )
        .bind(phase.plan_id)
        .fetch_optional(read_pool)
        .await
        .map_err(|e| format!("Failed to read plan: {e}"))?;

        // Fetch previously completed phases (lower step numbers)
        let completed: Vec<(i64, String)> = sqlx::query_as(
            "SELECT step_number, title FROM phases WHERE plan_id = ? AND status = 'completed' AND step_number < ? ORDER BY step_number, order_index",
        )
        .bind(phase.plan_id)
        .bind(phase.step_number)
        .fetch_all(read_pool)
        .await
        .map_err(|e| format!("Failed to read completed phases: {e}"))?;

        let mut sections: Vec<String> = Vec::new();

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
                .map(|(step, title)| format!("- Step {step}: {title}"))
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

    /// Build an enriched initial prompt for QA phases, matching the legacy
    /// `createQaConfig()`. Includes PRD (if final QA), completed phases summary,
    /// QA procedure, and fix phase instructions.
    async fn build_enriched_qa_prompt(
        &self,
        read_pool: &SqlitePool,
        phase: &Phase,
        feature_id: i64,
    ) -> Result<String, String> {
        // Fetch QA procedure from project
        let qa_prompt: String = sqlx::query_scalar::<_, Option<String>>(
            "SELECT p.qa_prompt FROM projects p JOIN features f ON f.project_id = p.id WHERE f.id = ?",
        )
        .bind(feature_id)
        .fetch_optional(read_pool)
        .await
        .map_err(|e| format!("Failed to read QA prompt: {e}"))?
        .flatten()
        .unwrap_or_else(|| "Run any available tests and verify the implementation works correctly.".to_string());

        // Fetch completed phases summary
        let completed: Vec<(i64, String, Option<String>)> = sqlx::query_as(
            "SELECT step_number, title, implementation_notes FROM phases WHERE plan_id = ? AND status = 'completed' ORDER BY step_number, order_index",
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
                .map(|(step, title, notes)| {
                    let mut entry = format!("- **Phase (step {step}): {title}**");
                    if let Some(n) = notes {
                        if !n.is_empty() {
                            entry.push_str(&format!("\n  - {n}"));
                        }
                    }
                    entry
                })
                .collect::<Vec<_>>()
                .join("\n");
            format!("The following phases have been completed:\n\n{list}")
        };

        // Check if this is a final QA (all non-QA phases completed) — include PRD if so
        let pending_non_qa: Option<(i64,)> = sqlx::query_as(
            "SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND (phase_type IS NULL OR phase_type != 'qa') AND status != 'completed'",
        )
        .bind(phase.plan_id)
        .fetch_optional(read_pool)
        .await
        .map_err(|e| format!("Failed to check pending phases: {e}"))?;

        let mut prd_section = String::new();
        if pending_non_qa.map_or(false, |(cnt,)| cnt == 0) {
            let prd: Option<(Option<String>,)> = sqlx::query_as(
                "SELECT prd FROM features WHERE id = ?",
            )
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

        // Get max step number for fix phase instructions
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

    /// Build an enriched initial prompt for the review agent, matching the legacy
    /// `createReviewConfig()`. Includes PRD, plan summary, context, clarifications,
    /// completed phases, and git diff instructions.
    async fn build_enriched_review_prompt(
        &self,
        read_pool: &SqlitePool,
        feature_id: i64,
        feature_title: &str,
    ) -> Result<String, String> {
        // Look up the plan
        let plan: Option<(i64, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT id, summary, context, clarifications FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1",
        )
        .bind(feature_id)
        .fetch_optional(read_pool)
        .await
        .map_err(|e| format!("Failed to read plan: {e}"))?;

        let mut sections: Vec<String> = Vec::new();

        // PRD
        let prd: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT prd FROM features WHERE id = ?",
        )
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

        // Completed phases
        if plan_id > 0 {
            let completed: Vec<(i64, String)> = sqlx::query_as(
                "SELECT step_number, title FROM phases WHERE plan_id = ? AND status = 'completed' ORDER BY step_number, order_index",
            )
            .bind(plan_id)
            .fetch_all(read_pool)
            .await
            .map_err(|e| format!("Failed to read completed phases: {e}"))?;

            if !completed.is_empty() {
                let list: String = completed
                    .iter()
                    .map(|(step, title)| format!("- Step {step}: {title}"))
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
}

use crate::domain::features::repository::map_phase_type_to_item_type;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_phase_type_mapping() {
        assert_eq!(map_phase_type_to_item_type(Some("setup")), "execute");
        assert_eq!(map_phase_type_to_item_type(Some("value")), "execute");
        assert_eq!(map_phase_type_to_item_type(Some("qa")), "qa");
        assert_eq!(map_phase_type_to_item_type(None), "execute");
        assert_eq!(map_phase_type_to_item_type(Some("unknown")), "execute");
    }

    #[test]
    fn parse_depends_on_empty_string() {
        assert_eq!(parse_depends_on(""), Vec::<String>::new());
        assert_eq!(parse_depends_on("   "), Vec::<String>::new());
    }

    #[test]
    fn parse_depends_on_json_array() {
        assert_eq!(parse_depends_on(r#"["A", "B"]"#), vec!["A", "B"]);
    }

    #[test]
    fn parse_depends_on_json_array_single() {
        assert_eq!(parse_depends_on(r#"["A"]"#), vec!["A"]);
    }

    #[test]
    fn parse_depends_on_comma_separated() {
        assert_eq!(parse_depends_on("A, B"), vec!["A", "B"]);
    }

    #[test]
    fn parse_depends_on_single_value() {
        assert_eq!(parse_depends_on("A"), vec!["A"]);
    }

    #[test]
    fn parse_depends_on_whitespace_handling() {
        assert_eq!(parse_depends_on("  A , B  "), vec!["A", "B"]);
        assert_eq!(parse_depends_on("  A  "), vec!["A"]);
    }

    #[test]
    fn test_agent_type_mapping() {
        let strategy = FeatureBuildStrategy;
        assert!(matches!(strategy.agent_type_for_item("execute"), Ok(AgentType::Execute)));
        assert!(matches!(strategy.agent_type_for_item("qa"), Ok(AgentType::Qa)));
        assert!(matches!(strategy.agent_type_for_item("review"), Ok(AgentType::Review)));
        assert!(matches!(strategy.agent_type_for_item("risk"), Ok(AgentType::Risk)));
        assert!(matches!(strategy.agent_type_for_item("retro"), Ok(AgentType::Retro)));
        assert!(strategy.agent_type_for_item("unknown").is_err());
    }

    // ── Prompt autonomy tests ──

    use crate::domain::workflow::prompts::{build_execute_prompt, build_qa_prompt, build_review_prompt};

    #[test]
    fn test_execute_system_prompt_approval_for_autonomy_1() {
        let prompt = build_execute_prompt("Phase 1", "do stuff", "feat: stuff", 1);
        assert!(prompt.contains("Ask the user for approval"), "autonomy 1 should require approval");
        assert!(!prompt.contains("Full Autonomy"), "autonomy 1 should not mention full autonomy");
    }

    #[test]
    fn test_execute_system_prompt_moderate_for_autonomy_2() {
        let prompt = build_execute_prompt("Phase 1", "do stuff", "feat: stuff", 2);
        assert!(prompt.contains("moderate autonomy") || prompt.contains("Autonomy note"),
            "autonomy 2 should use moderate completion");
    }

    #[test]
    fn test_execute_system_prompt_auto_for_autonomy_3() {
        let prompt = build_execute_prompt("Phase 1", "do stuff", "feat: stuff", 3);
        assert!(prompt.contains("Commit your changes first") || prompt.contains("commit has succeeded"),
            "autonomy 3 should use auto completion");
    }

    #[test]
    fn test_qa_system_prompt_approval_for_autonomy_1() {
        let prompt = build_qa_prompt("QA Phase", "test stuff", 1);
        assert!(prompt.contains("Approval Loop") || prompt.contains("AskUserQuestion"),
            "QA autonomy 1 should require approval");
    }

    #[test]
    fn test_qa_system_prompt_auto_for_autonomy_3() {
        let prompt = build_qa_prompt("QA Phase", "test stuff", 3);
        assert!(prompt.contains("Full Autonomy") || prompt.contains("FULL AUTONOMY"),
            "QA autonomy 3 should use full autonomy");
    }

    #[test]
    fn test_review_system_prompt_approval_for_autonomy_1() {
        let prompt = build_review_prompt(1);
        assert!(prompt.contains("Approval Loop") || prompt.contains("AskUserQuestion"),
            "Review autonomy 1 should require approval");
    }

    #[test]
    fn test_review_system_prompt_auto_for_autonomy_3() {
        let prompt = build_review_prompt(3);
        assert!(prompt.contains("Full Autonomy") || prompt.contains("FULL AUTONOMY"),
            "Review autonomy 3 should use full autonomy");
    }

    // ── Enriched execute prompt autonomy tests (requires DB) ──

    async fn test_pool_with_schema() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE plans (id INTEGER PRIMARY KEY, feature_id INTEGER, summary TEXT, context TEXT, clarifications TEXT)"
        ).execute(&pool).await.unwrap();
        sqlx::query(
            "CREATE TABLE phases (id INTEGER PRIMARY KEY, plan_id INTEGER, step_number INTEGER, title TEXT, \
             status TEXT DEFAULT 'pending', complexity INTEGER, commit_message TEXT, \
             prompt TEXT, phase_type TEXT, implementation_notes TEXT, deviations TEXT, \
             order_index INTEGER DEFAULT 0, depends_on TEXT)"
        ).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO plans (id, feature_id, summary) VALUES (1, 1, 'test plan')")
            .execute(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO phases (id, plan_id, step_number, title, prompt, commit_message) VALUES (1, 1, 1, 'Test Phase', 'implement it', 'feat: test')"
        ).execute(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn test_enriched_execute_prompt_autonomy_1_shows_approval() {
        let pool = test_pool_with_schema().await;
        let phase: Phase = sqlx::query_as("SELECT * FROM phases WHERE id = 1")
            .fetch_one(&pool).await.unwrap();
        let strategy = FeatureBuildStrategy;
        let prompt = strategy.build_enriched_execute_prompt(&pool, &phase, 1).await.unwrap();
        assert!(prompt.contains("User Approval Required"), "autonomy 1 initial prompt should require user approval");
        assert!(!prompt.contains("Auto-Commit"), "autonomy 1 initial prompt should NOT contain Auto-Commit");
    }

    #[tokio::test]
    async fn test_enriched_execute_prompt_autonomy_3_shows_auto_commit() {
        let pool = test_pool_with_schema().await;
        let phase: Phase = sqlx::query_as("SELECT * FROM phases WHERE id = 1")
            .fetch_one(&pool).await.unwrap();
        let strategy = FeatureBuildStrategy;
        let prompt = strategy.build_enriched_execute_prompt(&pool, &phase, 3).await.unwrap();
        assert!(prompt.contains("Auto-Commit"), "autonomy 3 initial prompt should contain Auto-Commit");
        assert!(!prompt.contains("User Approval Required"), "autonomy 3 initial prompt should NOT require approval");
    }
}
