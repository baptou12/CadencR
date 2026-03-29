pub struct Prompts;

impl Prompts {
    pub fn plan() -> &'static str {
        include_str!("../../../prompts/plan.md")
    }
    pub fn prd() -> &'static str {
        include_str!("../../../prompts/prd.md")
    }
    pub fn execute_base() -> &'static str {
        include_str!("../../../prompts/execute-base.md")
    }
    pub fn execute_completion_approval() -> &'static str {
        include_str!("../../../prompts/execute-completion-approval.md")
    }
    pub fn execute_completion_auto() -> &'static str {
        include_str!("../../../prompts/execute-completion-auto.md")
    }
    pub fn execute_completion_moderate() -> &'static str {
        include_str!("../../../prompts/execute-completion-moderate.md")
    }
    pub fn qa_base() -> &'static str {
        include_str!("../../../prompts/qa-base.md")
    }
    pub fn qa_completion_approval() -> &'static str {
        include_str!("../../../prompts/qa-completion-approval.md")
    }
    pub fn qa_completion_auto() -> &'static str {
        include_str!("../../../prompts/qa-completion-auto.md")
    }
    pub fn qa_completion_moderate() -> &'static str {
        include_str!("../../../prompts/qa-completion-moderate.md")
    }
    pub fn review() -> &'static str {
        include_str!("../../../prompts/review.md")
    }
    pub fn review_completion_approval() -> &'static str {
        include_str!("../../../prompts/review-completion-approval.md")
    }
    pub fn review_completion_auto() -> &'static str {
        include_str!("../../../prompts/review-completion-auto.md")
    }
    pub fn review_completion_moderate() -> &'static str {
        include_str!("../../../prompts/review-completion-moderate.md")
    }
    pub fn session() -> &'static str {
        include_str!("../../../prompts/session.md")
    }
    pub fn risk() -> &'static str {
        include_str!("../../../prompts/risk.md")
    }
    pub fn retro() -> &'static str {
        include_str!("../../../prompts/retro.md")
    }
}

/// Build a constitution section for injection into agent prompts.
/// Returns an empty string if the constitution is empty.
pub fn constitution_section(constitution: &str) -> String {
    if constitution.trim().is_empty() {
        return String::new();
    }
    format!(
        "## Project Constitution\n\
         The following are hard constraints for this project. You MUST respect these principles — they are non-negotiable.\n\n\
         {}\n",
        constitution
    )
}

/// Fetch the project constitution for a feature. Shared helper to avoid duplicating
/// the join query across prompt builders and engine.
pub async fn fetch_project_constitution(
    pool: &sqlx::SqlitePool,
    feature_id: i64,
) -> Result<Option<String>, String> {
    sqlx::query_scalar::<_, Option<String>>(
        "SELECT p.constitution FROM projects p JOIN features f ON f.project_id = p.id WHERE f.id = ?",
    )
    .bind(feature_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to read constitution: {e}"))
    .map(|opt| opt.flatten().filter(|s| !s.trim().is_empty()))
}

/// Fetch the project constitution for a feature looked up via plan_id.
pub async fn fetch_constitution_by_plan(
    pool: &sqlx::SqlitePool,
    plan_id: i64,
) -> Result<Option<String>, String> {
    sqlx::query_scalar::<_, Option<String>>(
        "SELECT p.constitution FROM projects p JOIN features f ON f.project_id = p.id JOIN plans pl ON pl.feature_id = f.id WHERE pl.id = ?",
    )
    .bind(plan_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to read constitution: {e}"))
    .map(|opt| opt.flatten().filter(|s| !s.trim().is_empty()))
}

/// Build the full system prompt for a phase execution agent.
/// Combines execute-base + phase details + completion suffix.
/// `autonomy_level`: 1 = confirm everything, 2 = moderate, 3 = full auto.
pub fn build_execute_prompt(
    phase_title: &str,
    phase_prompt: &str,
    commit_message: &str,
    autonomy_level: u8,
) -> String {
    let base = Prompts::execute_base();
    let completion = match autonomy_level {
        3.. => Prompts::execute_completion_auto(),
        2 => Prompts::execute_completion_moderate(),
        _ => Prompts::execute_completion_approval(),
    };
    format!(
        "{base}\n\n## Important\n\
         - Stay focused on the current phase only\n\
         - If something is unclear, make a reasonable decision and proceed\n\
         - Quality over speed\n\
         - Always call mark_phase_done, even if everything went exactly to plan\n\n\
         ## Current Phase\n\n**Title:** {phase_title}\n**Commit Message:** {commit_message}\n\n{phase_prompt}\n\n{completion}\n\n\
         When your task is complete, call `mark_agent_done` and stop."
    )
}

/// Similar builder for QA prompts.
/// `autonomy_level`: 1 = confirm everything, 2 = moderate, 3 = full auto.
pub fn build_qa_prompt(phase_title: &str, phase_prompt: &str, autonomy_level: u8) -> String {
    let base = Prompts::qa_base();
    let completion = match autonomy_level {
        3.. => Prompts::qa_completion_auto(),
        2 => Prompts::qa_completion_moderate(),
        _ => Prompts::qa_completion_approval(),
    };
    format!(
        "{base}\n\n\
         ## Rules\n\
         - Design test cases that are SPECIFIC to what was actually implemented — not generic tests\n\
         - Use the project's QA procedure to know HOW to test (simulators, MCPs, browser tools, etc.)\n\
         - Actually interact with the application — do not just read code and guess\n\
         - Be thorough — test happy paths, edge cases, and error scenarios\n\
         - Provide evidence for each test result (screenshots, console output, etc.)\n\
         - If proposing fix phases, make them precise and actionable\n\n\
         ## Current QA Phase\n\n**Title:** {phase_title}\n\n{phase_prompt}\n\n{completion}"
    )
}

/// Build the full system prompt for the review agent.
/// Includes review base + autonomy-level completion suffix.
pub fn build_review_prompt(autonomy_level: u8) -> String {
    let base = Prompts::review();
    let completion = match autonomy_level {
        3.. => Prompts::review_completion_auto(),
        2 => Prompts::review_completion_moderate(),
        _ => Prompts::review_completion_approval(),
    };
    format!("{base}\n\n{completion}")
}
