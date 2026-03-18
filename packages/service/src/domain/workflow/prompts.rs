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
    pub fn qa_base() -> &'static str {
        include_str!("../../../prompts/qa-base.md")
    }
    pub fn qa_completion_approval() -> &'static str {
        include_str!("../../../prompts/qa-completion-approval.md")
    }
    pub fn qa_completion_auto() -> &'static str {
        include_str!("../../../prompts/qa-completion-auto.md")
    }
    pub fn review() -> &'static str {
        include_str!("../../../prompts/review.md")
    }
}

/// Build the full system prompt for a phase execution agent.
/// Combines execute-base + phase details + completion suffix.
pub fn build_execute_prompt(
    phase_title: &str,
    phase_prompt: &str,
    commit_message: &str,
    autonomy_auto: bool,
) -> String {
    let base = Prompts::execute_base();
    let completion = if autonomy_auto {
        Prompts::execute_completion_auto()
    } else {
        Prompts::execute_completion_approval()
    };
    format!(
        "{base}\n\n## Current Phase\n\n**Title:** {phase_title}\n**Commit Message:** {commit_message}\n\n{phase_prompt}\n\n{completion}"
    )
}

/// Similar builder for QA prompts.
pub fn build_qa_prompt(phase_title: &str, phase_prompt: &str, autonomy_auto: bool) -> String {
    let base = Prompts::qa_base();
    let completion = if autonomy_auto {
        Prompts::qa_completion_auto()
    } else {
        Prompts::qa_completion_approval()
    };
    format!(
        "{base}\n\n## Current QA Phase\n\n**Title:** {phase_title}\n\n{phase_prompt}\n\n{completion}"
    )
}
