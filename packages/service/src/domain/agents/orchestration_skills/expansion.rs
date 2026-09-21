//! Turns a user message that names virtual skills into the text the agent runs.
//!
//! Two shapes, one pass:
//!
//! * A **leading invocation** (`/cadencr:review <args>`) is the classic slash
//!   command — the whole message is the command, so the skill body replaces it
//!   and the trailing text becomes `$ARGUMENTS`.
//! * An **embedded reference** (`check the diff, then /cadencr:review`) is part
//!   of a sentence. The user's message is kept verbatim and the referenced
//!   skills' instructions are appended in one clearly delimited section, so a
//!   long prompt body never lands in the middle of a sentence and no part of the
//!   sentence is silently claimed as an argument string.
//!
//! Both shapes can appear in one message: the leading command expands as usual
//! and any *other* skill referenced further in is appended. Each distinct skill
//! contributes its instructions exactly once, in order of appearance, and only
//! the user's own text is scanned — never the text this module generates.

use std::borrow::Cow;

use super::references::scan_references;
use super::{
    OrchestrationSkill, CHILD_COMPLETION_BOUNDARY, ORCHESTRATION_SKILLS,
    ORCHESTRATION_SKILL_PREFIX, PORTABLE_WORKFLOW_BOUNDARY,
};

/// Stands in for `$ARGUMENTS` when a skill is referenced inside a sentence: the
/// surrounding message is the request, so no substring is promoted to an
/// argument.
const EMBEDDED_ARGUMENTS: &str = "(none — use the user's message above as the request)";

/// Expand every virtual skill the user invoked or referenced in `text`, or
/// return it untouched when it names none.
///
/// Deliberately strict: a leading token may use the `/`, `$`, or bare
/// `cadencr:` form, while a reference further into the message requires an
/// explicit `/cadencr:` or `$cadencr:` prefix outside code and quotes. A normal
/// message like "review this diff" can never be hijacked.
pub fn expand_prompt(text: &str) -> Cow<'_, str> {
    let head = head_invocation(text);
    let embedded = embedded_skills(
        head.map_or(text, |(_, rest)| rest),
        head.map(|(skill, _)| skill),
    );
    if head.is_none() && embedded.is_empty() {
        return Cow::Borrowed(text);
    }
    let expanded = match head {
        Some((skill, args)) => skill.expand(args),
        None => text.to_string(),
    };
    if embedded.is_empty() {
        return Cow::Owned(expanded);
    }
    Cow::Owned(format!(
        "{expanded}\n\n{}",
        embedded_section(&embedded, head.map(|(skill, _)| skill))
    ))
}

/// The skill invoked by the first token, with the text that follows it.
fn head_invocation(text: &str) -> Option<(&'static OrchestrationSkill, &str)> {
    let trimmed = text.trim_start();
    let token_end = trimmed.find(char::is_whitespace).unwrap_or(trimmed.len());
    let (token, rest) = trimmed.split_at(token_end);
    let bare = token
        .strip_prefix('/')
        .or_else(|| token.strip_prefix('$'))
        .unwrap_or(token);
    let name = bare.strip_prefix(ORCHESTRATION_SKILL_PREFIX)?;
    Some((find_skill(name)?, rest))
}

/// Known skills referenced inside `text`, in order of first appearance, never
/// repeating the skill the leading command already expanded. Unknown names are
/// dropped here so they stay plain text.
fn embedded_skills(
    text: &str,
    head: Option<&OrchestrationSkill>,
) -> Vec<&'static OrchestrationSkill> {
    scan_references(text)
        .into_iter()
        .filter(|name| !head.is_some_and(|skill| skill.name == *name))
        .filter_map(find_skill)
        .collect()
}

fn find_skill(name: &str) -> Option<&'static OrchestrationSkill> {
    ORCHESTRATION_SKILLS.iter().find(|skill| skill.name == name)
}

/// Render the appended instructions for skills referenced inside the message.
/// Shared boundaries are emitted once, and skipped when the leading command's
/// own expansion already carries them.
fn embedded_section(skills: &[&OrchestrationSkill], head: Option<&OrchestrationSkill>) -> String {
    let needs_workflow_boundary = head.is_none();
    let needs_child_boundary = !head.is_some_and(|skill| skill.includes_child_completion_boundary)
        && skills
            .iter()
            .any(|skill| skill.includes_child_completion_boundary);

    let mut parts = vec![
        "The user's message above references the CadencR virtual skills below. Treat that message as the request and run each skill's instructions in the order listed, using the message as their context.".to_string(),
    ];
    if needs_workflow_boundary {
        parts.push(PORTABLE_WORKFLOW_BOUNDARY.to_string());
    }
    if needs_child_boundary {
        parts.push(CHILD_COMPLETION_BOUNDARY.to_string());
    }
    parts.extend(skills.iter().map(|skill| {
        format!(
            "### {}\n\n{}",
            skill.command(),
            skill.body.replace("$ARGUMENTS", EMBEDDED_ARGUMENTS)
        )
    }));
    format!(
        "[CADENCR SKILL INSTRUCTIONS]\n{}\n[/CADENCR SKILL INSTRUCTIONS]",
        parts.join("\n\n")
    )
}

#[cfg(test)]
mod tests {
    use super::{expand_prompt, ORCHESTRATION_SKILLS, PORTABLE_WORKFLOW_BOUNDARY};

    fn skill_body(name: &str) -> &'static str {
        ORCHESTRATION_SKILLS
            .iter()
            .find(|skill| skill.name == name)
            .unwrap()
            .body
    }

    #[test]
    fn expand_prompt_expands_namespaced_invocation_across_prefixes() {
        // With no arguments the `$ARGUMENTS` placeholder collapses to empty.
        let expected = format!(
            "{PORTABLE_WORKFLOW_BOUNDARY}\n\n{}",
            skill_body("status").replace("$ARGUMENTS", "")
        );
        for token in ["cadencr:status", "/cadencr:status", "$cadencr:status"] {
            let expanded = expand_prompt(token);
            assert_eq!(expanded, expected, "prefix {token}");
            assert!(expanded.starts_with("## CadencR workflow boundary"));
            assert!(expanded.contains("This virtual skill is self-contained"));
            assert!(expanded.contains("Do not search the filesystem for CadencR's installation"));
            assert!(expanded.contains("Inter-agent messages steer an active target turn"));
            assert!(expanded.contains("Do **not** poll"));
            assert!(!expanded.contains("## Child completion ownership"));
        }
    }

    #[test]
    fn expand_prompt_substitutes_trailing_arguments() {
        for (name, arguments) in [
            ("review", "branch"),
            ("parallelize", "backend tests; frontend tests"),
            ("handoff", "continue with a different model"),
        ] {
            let invocation = format!("/cadencr:{name} {arguments}");
            let expanded = expand_prompt(&invocation);
            assert!(expanded.contains(arguments), "skill {name}");
            assert!(!expanded.contains("$ARGUMENTS"), "skill {name}");
        }
    }

    #[test]
    fn handoff_requires_spawn_before_explicit_handoff_link() {
        let expanded = expand_prompt("/cadencr:handoff use another model");
        let spawn = expanded
            .find("first call `project_spawn_session`")
            .expect("spawn instruction");
        let link = expanded
            .find("call `project_link_sessions`")
            .expect("handoff link instruction");

        assert!(spawn < link);
        assert!(expanded.contains("not successful until both"));
    }

    #[test]
    fn followed_skills_get_the_shared_child_completion_boundary() {
        for name in ["review", "rescue", "parallelize", "handoff"] {
            let invocation = format!("/cadencr:{name}");
            let expanded = expand_prompt(&invocation);
            assert!(expanded.contains("## Child completion ownership"));
            assert!(
                expanded.contains("visible to the user in this conversation"),
                "{name} must recognize that the child reply is already visible"
            );
            assert!(expanded.contains(
                "Do not repeat, paraphrase, reformat, summarize, or quote the child's final"
            ));
        }

        let review = expand_prompt("/cadencr:review");
        assert!(review.contains("ask the user what they want to do"));
        assert!(review.contains("with the review"));
    }

    #[test]
    fn expand_prompt_never_hijacks_a_plain_message() {
        // Bare words that merely resemble a skill name must pass through.
        for text in [
            "review this diff please",
            "status update for the team",
            "cadencr is great",
            "please run cadencr:status later",
            "",
        ] {
            assert_eq!(expand_prompt(text), text, "text {text:?}");
        }
    }

    #[test]
    fn expand_prompt_ignores_unknown_skill_name() {
        assert_eq!(expand_prompt("/cadencr:nope"), "/cadencr:nope");
        assert_eq!(
            expand_prompt("check this then /cadencr:nope"),
            "check this then /cadencr:nope"
        );
    }

    #[test]
    fn embedded_reference_keeps_the_message_and_appends_instructions() {
        let text = "Check the changes, then /cadencr:status focusing on blocked gates.";
        let expanded = expand_prompt(text);

        assert!(expanded.starts_with(text), "user message must be preserved");
        assert!(expanded.contains("[CADENCR SKILL INSTRUCTIONS]"));
        assert!(expanded.contains("[/CADENCR SKILL INSTRUCTIONS]"));
        assert!(expanded.contains("### cadencr:status"));
        assert!(expanded.contains("## CadencR workflow boundary"));
        assert!(expanded.contains("workspace_session_graph"));
        assert!(!expanded.contains("$ARGUMENTS"));
        // The surrounding sentence is context, never an argument string.
        assert!(!expanded.contains("**Scope argument:** `focusing on blocked gates.`"));
    }

    #[test]
    fn embedded_reference_works_with_the_dollar_trigger_and_multiline_text() {
        let text = "First, read the diff.\n\nThen $cadencr:status and report back.";
        let expanded = expand_prompt(text);

        assert!(expanded.starts_with(text));
        assert!(expanded.contains("### cadencr:status"));
    }

    #[test]
    fn embedded_reference_adds_the_child_completion_boundary_only_when_needed() {
        let status = expand_prompt("look, then /cadencr:status");
        assert!(!status.contains("## Child completion ownership"));

        let review = expand_prompt("look, then /cadencr:review");
        assert!(review.contains("## Child completion ownership"));
    }

    #[test]
    fn distinct_embedded_skills_expand_once_each_in_order() {
        let text = "First /cadencr:status then /cadencr:review then /cadencr:status again";
        let expanded = expand_prompt(text);

        assert!(expanded.starts_with(text));
        let status = expanded.find("### cadencr:status").expect("status section");
        let review = expanded.find("### cadencr:review").expect("review section");
        assert!(status < review);
        assert_eq!(expanded.matches("### cadencr:status").count(), 1);
        assert_eq!(expanded.matches("### cadencr:review").count(), 1);
        assert_eq!(expanded.matches("## CadencR workflow boundary").count(), 1);
        assert_eq!(expanded.matches("## Child completion ownership").count(), 1);
    }

    #[test]
    fn leading_command_plus_embedded_reference_expands_both_without_duplication() {
        let expanded = expand_prompt("/cadencr:review the diff, then /cadencr:status");

        // The leading command still expands in place, arguments and all.
        assert!(expanded.starts_with("## CadencR workflow boundary"));
        assert!(expanded.contains("**Scope argument:** `the diff, then /cadencr:status`"));
        // The second skill is appended once; the first is not repeated.
        assert!(expanded.contains("### cadencr:status"));
        assert!(!expanded.contains("### cadencr:review"));
        assert_eq!(expanded.matches("## CadencR workflow boundary").count(), 1);
        assert_eq!(expanded.matches("## Child completion ownership").count(), 1);
    }

    #[test]
    fn leading_command_repeated_further_in_expands_once() {
        let expanded = expand_prompt("/cadencr:status and again /cadencr:status");

        assert!(!expanded.contains("[CADENCR SKILL INSTRUCTIONS]"));
        assert_eq!(expanded.matches("workspace_session_graph").count(), 1);
    }

    #[test]
    fn generated_instructions_are_never_rescanned() {
        // `parallelize`'s body mentions other workflows; expanding it must not
        // pull their instructions in.
        let expanded = expand_prompt("/cadencr:parallelize backend; frontend");
        assert!(!expanded.contains("[CADENCR SKILL INSTRUCTIONS]"));
    }

    #[test]
    fn quoted_examples_never_expand_into_a_workflow() {
        // Each of these once slipped past the scanner and appended a full
        // workflow — including `review`, which tells the agent to spawn a
        // session — from what the user wrote as an example.
        for text in [
            "Example:\n````text\n```\n/cadencr:review\n```\n````",
            "Example:\n```text\n~~~\n/cadencr:review\n~~~\n```",
            "Example: `literal\n/cadencr:review\nend`",
            "Example: `` unmatched then `literal /cadencr:review`",
        ] {
            let expanded = expand_prompt(text);
            assert_eq!(expanded, text, "text {text:?}");
            assert!(
                !expanded.contains("CadencR workflow boundary"),
                "text {text:?}"
            );
        }
    }

    #[test]
    fn a_real_invocation_after_a_quoted_example_still_expands() {
        // The fix must not mask the rest of the message.
        for (text, marker) in [
            (
                "Example:\n````\n/cadencr:review\n````\n\nNow do /cadencr:status",
                "### cadencr:status",
            ),
            (
                "Example: `literal\nend` then /cadencr:status",
                "### cadencr:status",
            ),
        ] {
            let expanded = expand_prompt(text);
            assert!(expanded.starts_with(text), "text {text:?}");
            assert!(expanded.contains(marker), "text {text:?}");
            assert!(!expanded.contains("### cadencr:review"), "text {text:?}");
        }
    }

    #[test]
    fn embedded_references_ignore_code_quotes_and_urls() {
        for text in [
            "run it with `/cadencr:status` when ready",
            "example:\n\n```\n/cadencr:status\n```\n",
            "> the docs say /cadencr:status",
            "see https://example.com/cadencr:status",
            r"escaped \/cadencr:status stays text",
            "mid-word a/cadencr:status",
        ] {
            assert_eq!(expand_prompt(text), text, "text {text:?}");
        }
    }
}
