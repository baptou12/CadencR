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
        "{base}\n\n## Current Phase\n\n**Title:** {phase_title}\n**Commit Message:** {commit_message}\n\n{phase_prompt}\n\n{completion}"
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
        "{base}\n\n## Current QA Phase\n\n**Title:** {phase_title}\n\n{phase_prompt}\n\n{completion}"
    )
}
