//! Wire types for the review-threads GraphQL queries, and their mapping onto
//! the provider-neutral comment types.

use serde::Deserialize;

use super::super::{map_user, GitHubUser};
use crate::domain::git::forge::provider::{ForgeError, ForgeUser, PrComment, ThreadSide};

#[derive(Deserialize)]
pub(super) struct GraphQlResponse<T> {
    data: Option<T>,
    #[serde(default)]
    errors: Vec<GraphQlError>,
}

impl<T> GraphQlResponse<T> {
    /// GraphQL answers `200 OK` for failures, so the HTTP layer cannot surface
    /// them — unwrap the envelope here or the caller silently sees zero threads.
    fn payload(self, missing: &str) -> Result<T, ForgeError> {
        if let Some(error) = self.errors.first() {
            return Err(ForgeError::Response(format!(
                "GitHub could not read review threads: {}",
                error.message
            )));
        }
        self.data
            .ok_or_else(|| ForgeError::Response(format!("GitHub did not return {missing}")))
    }
}

impl GraphQlResponse<ThreadsQueryData> {
    pub(super) fn into_review_threads(self) -> Result<ReviewThreadConnection, ForgeError> {
        let data = self.payload("this pull request's review threads")?;
        data.repository
            .and_then(|repository| repository.pull_request)
            .map(|pull_request| pull_request.review_threads)
            .ok_or_else(|| {
                ForgeError::Response(
                    "GitHub did not return this pull request's review threads".into(),
                )
            })
    }
}

impl GraphQlResponse<ThreadCommentsQueryData> {
    pub(super) fn into_thread_comments(self) -> Result<CommentConnection, ForgeError> {
        let data = self.payload("the rest of a review thread's comments")?;
        data.node.map(|node| node.comments).ok_or_else(|| {
            ForgeError::Response("GitHub did not return the review thread being paged".into())
        })
    }
}

pub(super) fn map_comment(comment: ReviewThreadComment) -> PrComment {
    PrComment {
        author: map_author(comment.author),
        body_markdown: comment.body,
        created_at: comment.created_at,
        url: comment.url,
    }
}

pub(super) fn thread_side(value: GitHubDiffSide) -> ThreadSide {
    match value {
        GitHubDiffSide::Left => ThreadSide::Old,
        GitHubDiffSide::Right => ThreadSide::New,
    }
}

/// `author` is null for comments whose account was deleted. GitHub renders
/// those as "ghost"; matching that keeps the attribution honest instead of
/// leaving the comment looking unattributed.
fn map_author(author: Option<GitHubUser>) -> ForgeUser {
    match author {
        Some(actor) => map_user(actor),
        None => ForgeUser {
            username: "ghost".into(),
            display_name: None,
            avatar_url: None,
        },
    }
}

#[derive(Deserialize)]
struct GraphQlError {
    message: String,
}

#[derive(Deserialize)]
pub(super) struct ThreadsQueryData {
    repository: Option<RepositoryData>,
}

#[derive(Deserialize)]
struct RepositoryData {
    #[serde(rename = "pullRequest")]
    pull_request: Option<PullRequestData>,
}

#[derive(Deserialize)]
struct PullRequestData {
    #[serde(rename = "reviewThreads")]
    review_threads: ReviewThreadConnection,
}

#[derive(Deserialize)]
pub(super) struct ThreadCommentsQueryData {
    node: Option<ThreadNodeData>,
}

#[derive(Deserialize)]
struct ThreadNodeData {
    comments: CommentConnection,
}

#[derive(Deserialize)]
pub(super) struct ReviewThreadConnection {
    #[serde(rename = "pageInfo")]
    pub(super) page_info: PageInfo,
    pub(super) nodes: Vec<ReviewThreadNode>,
}

#[derive(Deserialize)]
pub(super) struct PageInfo {
    #[serde(rename = "hasNextPage")]
    pub(super) has_next_page: bool,
    #[serde(rename = "endCursor")]
    pub(super) end_cursor: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct ReviewThreadNode {
    pub(super) id: String,
    #[serde(rename = "isResolved")]
    pub(super) is_resolved: bool,
    #[serde(rename = "isOutdated")]
    pub(super) is_outdated: bool,
    pub(super) path: Option<String>,
    pub(super) line: Option<u64>,
    #[serde(rename = "originalLine")]
    pub(super) original_line: Option<u64>,
    #[serde(rename = "diffSide")]
    pub(super) diff_side: Option<GitHubDiffSide>,
    pub(super) comments: CommentConnection,
}

#[derive(Deserialize)]
pub(super) struct CommentConnection {
    #[serde(rename = "pageInfo")]
    pub(super) page_info: PageInfo,
    pub(super) nodes: Vec<ReviewThreadComment>,
}

#[derive(Deserialize)]
pub(super) struct ReviewThreadComment {
    body: String,
    #[serde(rename = "createdAt")]
    created_at: String,
    url: Option<String>,
    author: Option<GitHubUser>,
}

#[derive(Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(super) enum GitHubDiffSide {
    Left,
    Right,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graphql_errors_beat_a_partial_data_payload() {
        let response: GraphQlResponse<ThreadsQueryData> =
            serde_json::from_value(serde_json::json!({
                "data": { "repository": null },
                "errors": [{ "message": "Resource not accessible by integration" }],
            }))
            .expect("envelope parses");

        let error = match response.into_review_threads() {
            Err(error) => error,
            Ok(_) => panic!("GraphQL errors must surface"),
        };

        assert!(matches!(error, ForgeError::Response(message)
            if message.contains("Resource not accessible")));
    }

    #[test]
    fn a_deleted_author_maps_to_ghost_rather_than_nothing() {
        let comment: ReviewThreadComment = serde_json::from_value(serde_json::json!({
            "body": "needs a guard",
            "createdAt": "2026-07-01T10:00:00Z",
            "url": null,
            "author": null,
        }))
        .expect("comment parses");

        assert_eq!(map_comment(comment).author.username, "ghost");
    }

    #[test]
    fn diff_side_maps_left_to_the_pre_image() {
        assert_eq!(thread_side(GitHubDiffSide::Left), ThreadSide::Old);
        assert_eq!(thread_side(GitHubDiffSide::Right), ThreadSide::New);
    }

    #[test]
    fn unknown_diff_sides_fail_at_the_wire_boundary() {
        let result = serde_json::from_value::<ReviewThreadNode>(serde_json::json!({
            "id": "PRRT_1",
            "isResolved": false,
            "isOutdated": false,
            "path": "src/main.rs",
            "line": 10,
            "originalLine": 10,
            "diffSide": "MIDDLE",
            "comments": {
                "pageInfo": { "hasNextPage": false, "endCursor": null },
                "nodes": [],
            },
        }));
        let error = match result {
            Err(error) => error,
            Ok(_) => panic!("an unknown side must not silently become the new side"),
        };

        assert!(error.to_string().contains("unknown variant"));
    }
}
