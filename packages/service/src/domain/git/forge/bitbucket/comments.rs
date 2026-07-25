//! Groups a Bitbucket pull request's comments into provider-neutral threads.
//!
//! Bitbucket returns one flat list; a reply points at its root through
//! `parent.id`. Only inline comments are resolvable, and only the root carries
//! the `resolution` object — so a thread's file anchor and resolution both come
//! from whichever comment opened it.

use std::collections::BTreeMap;

use serde::Deserialize;

use super::{bitbucket_get, map_user, BitbucketLinks, BitbucketPage, BitbucketUser};
use crate::domain::git::forge::provider::{
    CommentThread, ForgeContext, ForgeError, PrComment, ThreadSide,
};

pub(super) async fn fetch(
    ctx: &ForgeContext,
    pr_number: u64,
) -> Result<Vec<CommentThread>, ForgeError> {
    let url = format!(
        "{}/repositories/{}/{}/pullrequests/{pr_number}/comments?pagelen=100",
        ctx.api_base_url, ctx.remote.owner, ctx.remote.repo
    );
    let response: BitbucketPage<BitbucketComment> =
        ctx.http.request_json(bitbucket_get(ctx, &url)?).await?;
    Ok(group(response.values))
}

fn group(comments: Vec<BitbucketComment>) -> Vec<CommentThread> {
    let mut threads = BTreeMap::<u64, CommentThread>::new();
    let mut comments = comments
        .into_iter()
        .filter(|comment| !comment.deleted)
        .collect::<Vec<_>>();
    // A thread takes its file anchor and resolution from its root comment, and
    // replies always carry a higher id — so walking in id order is what
    // guarantees the root lands first regardless of how the page was sorted.
    comments.sort_by_key(|comment| comment.id);

    for comment in comments {
        let root = comment
            .parent
            .as_ref()
            .map(|parent| parent.id)
            .unwrap_or(comment.id);
        threads
            .entry(root)
            .or_insert_with(|| open_thread(root, &comment))
            .comments
            .push(PrComment {
                author: map_user(comment.user),
                body_markdown: comment.content.raw,
                created_at: comment.created_on,
                url: comment
                    .links
                    .and_then(|links| links.html)
                    .map(|link| link.href),
            });
    }
    threads.into_values().collect()
}

fn open_thread(root: u64, comment: &BitbucketComment) -> CommentThread {
    let inline = comment.inline.as_ref();
    // Only inline comments are resolvable, so a top-level comment stays `None`
    // rather than masquerading as unresolved work.
    let resolved = inline.map(|_| comment.resolution.is_some());
    let (line, side) = inline.map_or((None, None), |inline| match inline.to {
        Some(to) => (Some(to), Some(ThreadSide::New)),
        None => (inline.from, inline.from.map(|_| ThreadSide::Old)),
    });
    CommentThread {
        id: format!("bitbucket-{root}"),
        resolved,
        // Bitbucket's inline payload carries no staleness flag.
        outdated: false,
        file: inline.and_then(|inline| inline.path.clone()),
        line,
        side,
        comments: Vec::new(),
    }
}

#[derive(Deserialize)]
struct BitbucketComment {
    id: u64,
    parent: Option<BitbucketCommentParent>,
    user: BitbucketUser,
    content: BitbucketContent,
    created_on: String,
    #[serde(default)]
    deleted: bool,
    inline: Option<BitbucketInline>,
    /// Present (with the resolving user and date) once someone marks the inline
    /// thread resolved; absent while it is still open.
    resolution: Option<serde_json::Value>,
    links: Option<BitbucketLinks>,
}

#[derive(Deserialize)]
struct BitbucketCommentParent {
    id: u64,
}

#[derive(Deserialize)]
struct BitbucketContent {
    #[serde(default)]
    raw: String,
}

#[derive(Deserialize)]
struct BitbucketInline {
    path: Option<String>,
    from: Option<u64>,
    to: Option<u64>,
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::domain::git::forge::test_support::{context, fixture, json_fixture_server};
    use crate::domain::git::host::GitHost;

    #[tokio::test]
    async fn inline_comments_report_resolution_and_side() {
        let mut routes = HashMap::new();
        routes.insert(
            "/repositories/acme/repo/pullrequests/9/comments".into(),
            fixture("bitbucket_comments"),
        );
        let context = context(json_fixture_server(routes).await, GitHost::Bitbucket);

        let threads = fetch(&context, 9).await.expect("Bitbucket comments map");

        let open = threads
            .iter()
            .find(|thread| thread.line == Some(88))
            .expect("the open inline thread survives");
        assert_eq!(open.resolved, Some(false));
        assert_eq!(open.side, Some(ThreadSide::New));
        // The reply folds into its root rather than opening a second thread.
        assert_eq!(open.comments.len(), 2);

        let resolved = threads
            .iter()
            .find(|thread| thread.line == Some(12))
            .expect("the resolved inline thread survives");
        assert_eq!(resolved.resolved, Some(true));
        assert_eq!(resolved.side, Some(ThreadSide::Old));

        // A top-level comment is not resolvable on Bitbucket, so it must stay
        // `None` instead of masquerading as unresolved work.
        let general = threads
            .iter()
            .find(|thread| thread.file.is_none())
            .expect("the top-level comment survives");
        assert_eq!(general.resolved, None);
    }

    #[test]
    fn a_reply_listed_before_its_root_still_takes_the_root_anchor() {
        // Bitbucket does not promise ordering; sorting by id is what stops a
        // reply from defining the thread's file, line, and resolution.
        let payload = serde_json::json!([
            {
                "id": 2,
                "parent": { "id": 1 },
                "user": { "display_name": "Replier" },
                "content": { "raw": "agreed" },
                "created_on": "2026-07-20T10:02:00+00:00",
            },
            {
                "id": 1,
                "user": { "display_name": "Reviewer" },
                "content": { "raw": "please fix" },
                "created_on": "2026-07-20T09:14:00+00:00",
                "inline": { "path": "src/lib.rs", "to": 42 },
            },
        ]);
        let comments: Vec<BitbucketComment> =
            serde_json::from_value(payload).expect("comments parse");

        let threads = group(comments);

        assert_eq!(threads.len(), 1);
        assert_eq!(threads[0].file.as_deref(), Some("src/lib.rs"));
        assert_eq!(threads[0].line, Some(42));
        assert_eq!(threads[0].resolved, Some(false));
        assert_eq!(threads[0].comments.len(), 2);
    }
}
