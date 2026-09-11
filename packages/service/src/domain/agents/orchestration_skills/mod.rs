//! Provider-neutral catalog of the `/cadencr:*` **virtual** orchestration
//! skills.
//!
//! These are *not* installed into any provider (no files written into user
//! repos): they only exist inside Cadencr. Cadencr advertises them in the
//! composer's slash menu, and when one is invoked it expands the skill's prompt
//! body into the outgoing message before it reaches the agent. This keeps them
//! from leaking into a repo where they'd be broken — the skills only work while
//! Cadencr's project/workspace MCP tools are attached.
//!
//! This module is the single source of truth (name, description, prompt body);
//! it never branches on provider identity.

mod expansion;
mod references;

pub use expansion::expand_prompt;

/// Prefix that namespaces every virtual skill, e.g. `cadencr:review`.
pub const ORCHESTRATION_SKILL_PREFIX: &str = "cadencr:";

/// Shared boundary prepended to every expanded workflow.
const PORTABLE_WORKFLOW_BOUNDARY: &str = include_str!("prompts/workflow_boundary.md");
/// Additional boundary for workflows that can receive a pushed child completion.
const CHILD_COMPLETION_BOUNDARY: &str = include_str!("prompts/child_completion_boundary.md");

/// One virtual orchestration skill, surfaced as `/cadencr:<name>`.
pub struct OrchestrationSkill {
    /// Bare skill name; the surfaced command is `cadencr:<name>`.
    pub name: &'static str,
    /// One-line description used as the menu hint.
    pub description: &'static str,
    /// Prompt body expanded into the outgoing message when the skill runs.
    pub body: &'static str,
    /// Whether this workflow can receive a pushed child final message.
    includes_child_completion_boundary: bool,
}

impl OrchestrationSkill {
    /// The namespaced command token, e.g. `cadencr:review`.
    pub fn command(&self) -> String {
        format!("{ORCHESTRATION_SKILL_PREFIX}{}", self.name)
    }

    /// Expand this skill into the prompt text sent to the agent. Any trailing
    /// argument string the user typed after the command replaces the
    /// `$ARGUMENTS` placeholder the prompt bodies reference (the standard
    /// slash-command convention); with no arguments the placeholder collapses
    /// to empty.
    fn expand(&self, args: &str) -> String {
        let body = self.body.replace("$ARGUMENTS", args.trim());
        if self.includes_child_completion_boundary {
            format!("{PORTABLE_WORKFLOW_BOUNDARY}\n\n{CHILD_COMPLETION_BOUNDARY}\n\n{body}")
        } else {
            format!("{PORTABLE_WORKFLOW_BOUNDARY}\n\n{body}")
        }
    }
}

/// The complete, declarative catalog. Add a skill by adding an entry and its
/// prompt file under `prompts/` — nothing provider-specific belongs here.
pub const ORCHESTRATION_SKILLS: &[OrchestrationSkill] = &[
    OrchestrationSkill {
        name: "review",
        description: "Spawn an independent reviewer session on this worktree",
        body: include_str!("prompts/review.md"),
        includes_child_completion_boundary: true,
    },
    OrchestrationSkill {
        name: "rescue",
        description: "Hand this stuck conversation to a fresh model for an unblock suggestion",
        body: include_str!("prompts/rescue.md"),
        includes_child_completion_boundary: true,
    },
    OrchestrationSkill {
        name: "status",
        description: "Render the live tree of spawned Cadencr sessions and any blocked gates",
        body: include_str!("prompts/status.md"),
        includes_child_completion_boundary: false,
    },
    OrchestrationSkill {
        name: "parallelize",
        description: "Fan out independent sub-tasks into isolated Cadencr worktrees",
        body: include_str!("prompts/parallelize.md"),
        includes_child_completion_boundary: true,
    },
    OrchestrationSkill {
        name: "handoff",
        description: "Transfer this work to a successor session with a self-contained brief",
        body: include_str!("prompts/handoff.md"),
        includes_child_completion_boundary: true,
    },
];

#[cfg(test)]
mod tests {
    use super::ORCHESTRATION_SKILLS;

    #[test]
    fn catalog_has_expected_skills_with_bodies() {
        let names: Vec<&str> = ORCHESTRATION_SKILLS.iter().map(|s| s.name).collect();
        assert_eq!(
            names,
            vec!["review", "rescue", "status", "parallelize", "handoff"]
        );
        for skill in ORCHESTRATION_SKILLS {
            assert!(
                !skill.description.is_empty(),
                "{} missing description",
                skill.name
            );
            assert!(
                skill.body.len() > 100,
                "{} body looks empty/stub",
                skill.name
            );
        }
    }

    #[test]
    fn catalog_names_are_unique_and_command_safe() {
        let mut seen = std::collections::HashSet::new();
        for skill in ORCHESTRATION_SKILLS {
            assert!(
                seen.insert(skill.name),
                "duplicate skill name {}",
                skill.name
            );
            assert!(
                skill
                    .name
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c == '-'),
                "{} is not a safe command/file name",
                skill.name
            );
        }
    }
}
