//! How many review threads a proposal still has open.
//!
//! The count exists for one thing: letting the sidebar separate "checks pass
//! and nothing is left to answer" from "checks pass but reviewers are still
//! waiting". Every other check state — and the draft state — already outranks
//! both in that chip, so only green non-draft PRs are looked up and the rest
//! report `None`: unknown, never zero.

use std::collections::HashMap;

use futures::{stream, StreamExt};

use super::super::provider::{
    CiRollup, CiState, CommentThread, ForgeContext, ForgeError, ForgeProvider, PrState, PrSummary,
};
use super::PR_FANOUT;

pub(super) async fn unresolved_thread_counts(
    provider: &dyn ForgeProvider,
    context: &ForgeContext,
    prs: &HashMap<u64, PrSummary>,
    ci_by_pr: &HashMap<u64, Result<CiRollup, ForgeError>>,
) -> HashMap<u64, Result<u32, ForgeError>> {
    stream::iter(worth_counting(prs, ci_by_pr))
        .map(|number| async move {
            (
                number,
                provider
                    .comments(context, number)
                    .await
                    .map(|threads| count_unresolved(&threads)),
            )
        })
        .buffer_unordered(PR_FANOUT)
        .collect()
        .await
}

/// The PRs worth a second round trip.
///
/// A rollup that failed to load is not green, so it is skipped along with the
/// failing and running ones. Drafts are skipped too: the frontend's tone picker
/// returns "draft" before it ever looks at the count, so paying for one would
/// buy nothing a reader can see.
fn worth_counting(
    prs: &HashMap<u64, PrSummary>,
    ci_by_pr: &HashMap<u64, Result<CiRollup, ForgeError>>,
) -> Vec<u64> {
    ci_by_pr
        .iter()
        .filter(|(_, ci)| matches!(ci, Ok(rollup) if rollup.state == CiState::Passing))
        .map(|(number, _)| *number)
        .filter(|number| prs.get(number).is_some_and(|pr| pr.state != PrState::Draft))
        .collect()
}

/// Counts only the threads the forge itself reports as still open.
///
/// `Some(false)` is the one value that means "open". `None` means the forge has
/// no notion of resolution here at all — a top-level PR comment, a review body,
/// a GitLab note nobody marked resolvable — so calling it unresolved would be a
/// false statement, not a conservative one.
///
/// This is deliberately narrower than `isThreadUnresolved` in
/// `packages/desktop/src/lib/pr-review-threads.ts`, which answers a different
/// question: "what can I hand to the agent", where an ordinary comment counts.
/// Measured against real PRs, the loose rule reported 7/9/6 outstanding threads
/// on three PRs whose forges reported 3/5/0 — turning every green proposal
/// yellow and leaving the chip with nothing left to distinguish.
fn count_unresolved(threads: &[CommentThread]) -> u32 {
    threads
        .iter()
        .filter(|thread| thread.resolved == Some(false))
        .count() as u32
}

#[cfg(test)]
mod tests {
    use super::super::super::provider::{CiCheck, ForgeUser, PrComment, ReviewState};
    use super::*;

    fn rollup(state: CiState) -> Result<CiRollup, ForgeError> {
        Ok(CiRollup {
            state,
            checks: vec![CiCheck {
                name: "build".into(),
                state,
                url: None,
            }],
        })
    }

    fn thread(resolved: Option<bool>) -> CommentThread {
        CommentThread {
            id: format!("thread-{resolved:?}"),
            resolved,
            outdated: false,
            file: None,
            line: None,
            side: None,
            comments: vec![PrComment {
                author: ForgeUser {
                    username: "reviewer".into(),
                    display_name: None,
                    avatar_url: None,
                },
                body_markdown: "please fix".into(),
                created_at: "2026-07-26T00:00:00Z".into(),
                url: None,
            }],
        }
    }

    fn summary(number: u64, state: PrState) -> PrSummary {
        PrSummary {
            author: ForgeUser {
                username: "author".into(),
                display_name: None,
                avatar_url: None,
            },
            body_markdown: String::new(),
            head_sha: "abc".into(),
            number,
            pr_label: "Pull request".into(),
            review_state: ReviewState::None,
            source_branch: "feature/x".into(),
            state,
            target_branch: "main".into(),
            title: "Proposal".into(),
            updated_at: "2026-07-26T00:00:00Z".into(),
            url: "https://example.test/pr".into(),
        }
    }

    fn open_prs(numbers: &[u64]) -> HashMap<u64, PrSummary> {
        numbers
            .iter()
            .map(|number| (*number, summary(*number, PrState::Open)))
            .collect()
    }

    #[test]
    fn only_green_prs_are_worth_a_second_round_trip() {
        let ci_by_pr = HashMap::from([
            (1, rollup(CiState::Passing)),
            (2, rollup(CiState::Failing)),
            (3, rollup(CiState::Running)),
            (4, rollup(CiState::None)),
            (5, Err(ForgeError::RateLimited("slow down".into()))),
        ]);

        let mut green = worth_counting(&open_prs(&[1, 2, 3, 4, 5]), &ci_by_pr);
        green.sort_unstable();

        assert_eq!(green, vec![1]);
    }

    #[test]
    fn a_green_draft_is_not_worth_counting() {
        let ci_by_pr =
            HashMap::from([(1, rollup(CiState::Passing)), (2, rollup(CiState::Passing))]);
        let prs = HashMap::from([
            (1, summary(1, PrState::Draft)),
            (2, summary(2, PrState::Open)),
        ]);

        assert_eq!(worth_counting(&prs, &ci_by_pr), vec![2]);
    }

    #[test]
    fn a_pr_the_poller_never_listed_is_not_counted() {
        let ci_by_pr = HashMap::from([(1, rollup(CiState::Passing))]);

        assert!(worth_counting(&HashMap::new(), &ci_by_pr).is_empty());
    }

    #[test]
    fn only_threads_the_forge_calls_open_count_as_outstanding() {
        // `None` is "this forge has no notion of resolution here", not "open".
        // Counting it turned every green PR yellow and made the chip useless.
        let threads = vec![thread(Some(false)), thread(None), thread(Some(true))];

        assert_eq!(count_unresolved(&threads), 1);
    }

    #[test]
    fn a_proposal_with_no_threads_counts_zero_rather_than_unknown() {
        assert_eq!(count_unresolved(&[]), 0);
    }
}
