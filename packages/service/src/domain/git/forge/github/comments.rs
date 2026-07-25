//! Assembles a GitHub pull request's discussion into provider-neutral threads.
//!
//! Three sources merge here: issue comments (the top-level conversation),
//! review bodies (the summary a reviewer writes when submitting), and the
//! line-anchored review threads, which come over GraphQL because resolution
//! state exists nowhere in REST. See [`super::review_threads`].

use serde::Deserialize;

use super::{github_get, map_user, GitHubUser};
use crate::domain::git::forge::provider::{CommentThread, ForgeContext, ForgeError, PrComment};

pub(super) async fn fetch(
    ctx: &ForgeContext,
    repo_full_name: &str,
    pr_number: u64,
) -> Result<Vec<CommentThread>, ForgeError> {
    let base = format!("{}/repos/{repo_full_name}/", ctx.api_base_url);
    let issue_url = format!("{base}issues/{pr_number}/comments?per_page=100");
    let reviews_url = format!("{base}pulls/{pr_number}/reviews?per_page=100");
    let (issue_comments, reviews, review_threads): (
        Vec<GitHubIssueComment>,
        Vec<GitHubReview>,
        Vec<CommentThread>,
    ) = tokio::try_join!(
        ctx.http.request_json(github_get(ctx, &issue_url)),
        ctx.http.request_json(github_get(ctx, &reviews_url)),
        super::review_threads::fetch(ctx, repo_full_name, pr_number),
    )?;

    let mut threads = issue_comments
        .into_iter()
        .map(|comment| {
            unanchored(
                format!("issue-{}", comment.id),
                map_comment(
                    comment.user,
                    comment.body,
                    comment.created_at,
                    comment.html_url,
                ),
            )
        })
        .collect::<Vec<_>>();
    // A review with an empty body is just the envelope around its line comments,
    // which arrive as their own threads — showing it would be a blank card.
    threads.extend(reviews.into_iter().filter_map(|review| {
        (!review.body.trim().is_empty()).then(|| {
            unanchored(
                format!("review-{}", review.id),
                map_comment(
                    review.user,
                    review.body,
                    review.submitted_at.unwrap_or_default(),
                    review.html_url,
                ),
            )
        })
    }));
    threads.extend(review_threads);
    threads.sort_by(|left, right| {
        left.comments
            .first()
            .map(|comment| &comment.created_at)
            .cmp(&right.comments.first().map(|comment| &comment.created_at))
    });
    Ok(threads)
}

/// A thread with no file anchor: top-level discussion, which GitHub cannot
/// resolve and which therefore has no side or staleness of its own.
fn unanchored(id: String, comment: PrComment) -> CommentThread {
    CommentThread {
        id,
        resolved: None,
        outdated: false,
        file: None,
        line: None,
        side: None,
        comments: vec![comment],
    }
}

fn map_comment(
    user: GitHubUser,
    body: String,
    created_at: String,
    url: Option<String>,
) -> PrComment {
    PrComment {
        author: map_user(user),
        body_markdown: body,
        created_at,
        url,
    }
}

#[derive(Deserialize)]
struct GitHubIssueComment {
    id: u64,
    user: GitHubUser,
    body: String,
    created_at: String,
    html_url: Option<String>,
}

#[derive(Deserialize)]
struct GitHubReview {
    id: u64,
    user: GitHubUser,
    #[serde(default)]
    body: String,
    submitted_at: Option<String>,
    html_url: Option<String>,
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::domain::git::forge::provider::ThreadSide;
    use crate::domain::git::forge::test_support::{context, fixture, json_fixture_server};
    use crate::domain::git::host::GitHost;

    #[tokio::test]
    async fn merges_rest_discussion_with_graphql_review_threads() {
        let mut routes = HashMap::new();
        routes.insert(
            "/repos/acme/repo/issues/17/comments".into(),
            serde_json::json!([{
                "id": 1,
                "user": { "login": "commenter", "name": null, "avatar_url": null },
                "body": "Ship it once CI is green.",
                "created_at": "2026-07-18T08:00:00Z",
                "html_url": "https://github.com/acme/repo/pull/17#issuecomment-1",
            }]),
        );
        routes.insert(
            "/repos/acme/repo/pulls/17/reviews".into(),
            serde_json::json!([
                {
                    "id": 2,
                    "user": { "login": "reviewer-one", "name": null, "avatar_url": null },
                    "body": "  ",
                    "submitted_at": "2026-07-19T08:00:00Z",
                    "html_url": null,
                },
                {
                    "id": 3,
                    "user": { "login": "reviewer-one", "name": null, "avatar_url": null },
                    "body": "A few notes inline.",
                    "submitted_at": "2026-07-21T08:00:00Z",
                    "html_url": null,
                },
            ]),
        );
        routes.insert("/graphql".into(), fixture("github_review_threads"));
        let context = context(json_fixture_server(routes).await, GitHost::GitHub);

        let threads = fetch(&context, "acme/repo", 17)
            .await
            .expect("GitHub discussion assembles");

        // Issue comment + non-empty review body + two review threads. The
        // whitespace-only review body is an envelope, not a comment.
        assert_eq!(threads.len(), 4);
        assert!(threads
            .iter()
            .all(|thread| !thread.id.starts_with("review-2")));
        // Sorted oldest-first across all three sources.
        let created = threads
            .iter()
            .map(|thread| thread.comments[0].created_at.as_str())
            .collect::<Vec<_>>();
        let mut sorted = created.clone();
        sorted.sort_unstable();
        assert_eq!(created, sorted);
        // Line anchors survive the merge.
        let anchored = threads
            .iter()
            .find(|thread| thread.line == Some(42))
            .expect("the anchored thread survives");
        assert_eq!(anchored.side, Some(ThreadSide::New));
        assert_eq!(anchored.resolved, Some(false));
    }
}
