//! Spawn methods for pre-queue agents (plan, prd, session, refine, review-fixer, risk, retro).
//!
//! These are implemented as a separate `impl WorkflowEngine` block to keep
//! the core engine file focused on orchestration.

use tracing::warn;

use crate::domain::mcp::servers::AgentType;
use crate::domain::workflow::prompts::Prompts;
use crate::domain::workflow::strategies::feature_build_session_review;
use crate::domain::workflow::status::WorkflowStatus;
use crate::domain::ws_session::protocol::ImagePayload;

use super::agent_slot::AgentSlot;
use super::engine::WorkflowEngine;

impl WorkflowEngine {
    pub async fn spawn_plan_agent(&self, description: &str, images: &[ImagePayload]) -> Result<i64, String> {
        self.set_status(WorkflowStatus::Planning).await;
        let prd: Option<String> = sqlx::query_scalar::<_, Option<String>>(
            "SELECT prd FROM features WHERE id = ?",
        )
        .bind(self.feature_id)
        .fetch_optional(&self.read_pool)
        .await
        .map_err(|e| format!("Failed to read feature PRD: {e}"))?
        .flatten();

        let (preamble, desc) = if let Some(ref prd_content) = prd {
            if !prd_content.is_empty() {
                (
                    "Please create a detailed implementation plan based on the following Product Requirements Document (PRD):\n\n",
                    prd_content.as_str(),
                )
            } else {
                ("Please create a detailed implementation plan for the following feature:\n\n", description)
            }
        } else {
            ("Please create a detailed implementation plan for the following feature:\n\n", description)
        };

        let plan_instructions = "Start by exploring the codebase to understand the project structure and existing patterns. \
            Then ask me clarifying questions. Finally, build the phased plan using the tools, call show_plan, and ask for my approval.";

        let enriched_prompt = format!("{preamble}{desc}\n\n{plan_instructions}");

        self.agent_manager.spawn_pre_queue_agent(
            AgentType::Plan,
            "plan",
            Prompts::plan(),
            &enriched_prompt,
            images,
            |_| AgentSlot::Plan,
            &self.permissions,
        ).await
    }

    pub async fn spawn_prd_agent(&self, description: &str) -> Result<i64, String> {
        self.set_status(WorkflowStatus::Prd).await;
        let prd_instructions = "Use the MCP tools to build the PRD. Call create_prd to store the initial PRD content, \
            then call show_prd to present it for approval. If rejected, use edit_prd for targeted changes \
            (or create_prd for full rewrites), then call show_prd again. Once approved, call mark_agent_done.";

        let enriched_prompt = format!(
            "Please create a comprehensive PRD for the following feature:\n\n{description}\n\n{prd_instructions}"
        );

        self.agent_manager.spawn_pre_queue_agent(
            AgentType::Prd,
            "prd",
            Prompts::prd(),
            &enriched_prompt,
            &[],
            |_| AgentSlot::Prd,
            &self.permissions,
        ).await
    }

    pub async fn spawn_session_agent(&self, prompt: &str, images: &[ImagePayload]) -> Result<i64, String> {
        let enriched_prompt = feature_build_session_review::build_session_prompt(
            &self.read_pool,
            self.feature_id,
            prompt,
        )
        .await?;

        self.agent_manager.spawn_pre_queue_agent_with_display(
            AgentType::Session,
            "session",
            Prompts::session(),
            &enriched_prompt,
            Some(prompt),
            images,
            |id| AgentSlot::Session(id),
            &self.permissions,
        ).await
    }

    pub async fn spawn_refine_agent(&self, description: &str, images: &[ImagePayload]) -> Result<i64, String> {
        let refinement_prompt = match self.build_refine_context(description).await {
            Ok(prompt) => prompt,
            Err(e) => {
                warn!(feature_id = self.feature_id, error = %e, "failed to build refine context, using simple prompt");
                format!(
                    "The user wants to refine the existing plan.\n\n\
                     User's refinement request:\n{description}\n\n\
                     Please update the plan accordingly — add, modify, or remove phases as needed."
                )
            }
        };

        self.agent_manager.spawn_pre_queue_agent(
            AgentType::Plan,
            "plan",
            Prompts::plan(),
            &refinement_prompt,
            images,
            |_| AgentSlot::Refine,
            &self.permissions,
        ).await
    }

    pub async fn spawn_review_fixer_agent(&self, comments: &str) -> Result<i64, String> {
        let system_prompt = "You are a code review fixer. The user has reviewed a diff and provided comments. \
            Fix the issues described in the comments. Make minimal, focused changes.";

        self.agent_manager.spawn_pre_queue_agent(
            AgentType::Execute,
            "review-fixer",
            system_prompt,
            comments,
            &[],
            |id| AgentSlot::ReviewFixer(id),
            &self.permissions,
        ).await
    }

    pub async fn spawn_risk_agent(&self) -> Result<i64, String> {
        let feature: Option<(String,)> = sqlx::query_as(
            "SELECT title FROM features WHERE id = ?",
        )
        .bind(self.feature_id)
        .fetch_optional(&self.read_pool)
        .await
        .map_err(|e| format!("DB error querying feature: {e}"))?;

        let feature_title = feature.map(|f| f.0).unwrap_or_else(|| format!("#{}", self.feature_id));

        let plan: Option<(i64, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT id, summary, context, raw_markdown FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1",
        )
        .bind(self.feature_id)
        .fetch_optional(&self.read_pool)
        .await
        .map_err(|e| format!("DB error querying plan: {e}"))?;

        let phases: Vec<(i32, String, String)> = if let Some(ref p) = plan {
            sqlx::query_as(
                "SELECT step_number, title, status FROM phases WHERE plan_id = ? ORDER BY step_number, order_index",
            )
            .bind(p.0)
            .fetch_all(&self.read_pool)
            .await
            .unwrap_or_default()
        } else {
            vec![]
        };

        let rich_context = build_risk_context(&feature_title, &plan, &phases);

        let plan_id_note = plan.as_ref().map(|p| {
            format!("\n\n**Plan ID: {}** — Use this ID when calling MCP tools like `read_plan`, `list_phases`, `create_phase`, `finalize_phases`, etc.", p.0)
        }).unwrap_or_default();

        let prompt = format!(
            "Please perform a risk analysis for this feature.\n\n\
             {rich_context}{plan_id_note}\n\n\
             Start by running `git diff main...HEAD` (or the appropriate base branch) to see what code has actually changed. \
             Then explore the codebase to understand the full context and impact of these changes. Generate a comprehensive risk report."
        );

        self.agent_manager.spawn_pre_queue_agent(
            AgentType::Risk,
            "risk",
            Prompts::risk(),
            &prompt,
            &[],
            |id| AgentSlot::Risk(id),
            &self.permissions,
        ).await
    }

    pub async fn spawn_retro_agent(&self) -> Result<i64, String> {
        let plan: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1",
        )
        .bind(self.feature_id)
        .fetch_optional(&self.read_pool)
        .await
        .map_err(|e| format!("DB error querying plan: {e}"))?;

        let plan_hint = match plan {
            Some(p) => format!(
                "The plan ID for this feature is **{}**. Use this when calling `read_plan` and `list_phases`.",
                p.0
            ),
            None => "No plan was found for this feature — skip plan/phase reading and focus on PRD and conversations.".to_string(),
        };

        let prompt = format!(
            "Please produce a retrospective report for feature ID {}.\n\n\
             {plan_hint}\n\n\
             Use the available MCP tools to read the PRD, plan, phases, and agent conversation history, \
             then write the retrospective report in chat. When finished, call `mark_agent_done`.",
            self.feature_id
        );

        self.agent_manager.spawn_pre_queue_agent(
            AgentType::Retro,
            "retro",
            Prompts::retro(),
            &prompt,
            &[],
            |id| AgentSlot::Retro(id),
            &self.permissions,
        ).await
    }

    /// Build a rich refinement context matching the legacy `buildRefineContext()`.
    async fn build_refine_context(&self, description: &str) -> Result<String, String> {
        let plan: Option<(i64, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT id, summary, context FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1",
        )
        .bind(self.feature_id)
        .fetch_optional(&self.read_pool)
        .await
        .map_err(|e| format!("Failed to fetch plan: {e}"))?;

        let (plan_id, summary, context) = plan.ok_or("No plan found for this feature — cannot refine without an existing plan.")?;

        let phases: Vec<(i64, String, String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT step_number, title, status, implementation_notes, phase_type FROM phases \
             WHERE plan_id = ? ORDER BY step_number, order_index",
        )
        .bind(plan_id)
        .fetch_all(&self.read_pool)
        .await
        .map_err(|e| format!("Failed to fetch phases: {e}"))?;

        let max_step = phases.iter().map(|(s, _, _, _, _)| *s).max().unwrap_or(0);

        let mut parts: Vec<String> = Vec::new();
        if let Some(ref s) = summary {
            if !s.is_empty() {
                parts.push(format!("**Plan Summary:** {s}"));
            }
        }
        if let Some(ref c) = context {
            if !c.is_empty() {
                parts.push(format!("**Codebase Context:** {c}"));
            }
        }

        if !phases.is_empty() {
            parts.push("\n## Existing Phases:".to_string());
            for (step, title, status, notes, phase_type) in &phases {
                let mut line = format!("Step {step}. [{}] {title}", status.to_uppercase());
                if let Some(pt) = phase_type {
                    line.push_str(&format!(" ({pt})"));
                }
                if let Some(n) = notes {
                    if !n.is_empty() {
                        line.push_str(&format!("\n   Notes: {n}"));
                    }
                }
                parts.push(line);
            }
        }

        let refine_instructions = format!(
            "\n## Refinement Instructions\n\
             This is a REFINEMENT of an existing plan (Plan ID: {plan_id}). The phases listed above already exist.\n\
             - Do NOT recreate or duplicate completed phases.\n\
             - Add NEW phases to extend the plan based on the user's request below.\n\
             - Use step numbers starting from {}.\n\
             - You may also update or remove existing DRAFT or PENDING phases if needed.\n\
             - After building the new phases, call show_plan for approval, then finalize_plan.",
            max_step + 1,
        );

        Ok(format!(
            "{}\n{refine_instructions}\n\n## User's Refinement Request\n{description}",
            parts.join("\n"),
        ))
    }
}

/// Build the rich context string for risk analysis.
fn build_risk_context(
    feature_title: &str,
    plan: &Option<(i64, Option<String>, Option<String>, Option<String>)>,
    phases: &[(i32, String, String)],
) -> String {
    let mut context_parts = vec![format!("## Feature: {feature_title}")];
    if let Some(ref p) = plan {
        if let Some(ref summary) = p.1 {
            context_parts.push(format!("**Plan Summary:** {summary}"));
        }
        if let Some(ref ctx) = p.2 {
            context_parts.push(format!("**Codebase Context:** {ctx}"));
        }
    }
    if !phases.is_empty() {
        context_parts.push("\n## Phases:".to_string());
        for (step, title, status) in phases {
            context_parts.push(format!("{step}. {title} — {status}"));
        }
    }
    if let Some(ref p) = plan {
        if let Some(ref md) = p.3 {
            context_parts.push(format!("\n## Full Plan\n{md}"));
        }
    }
    context_parts.join("\n")
}
