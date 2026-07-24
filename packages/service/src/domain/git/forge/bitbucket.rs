use std::collections::BTreeMap;

use async_trait::async_trait;
use serde::Deserialize;

use super::provider::{
    proposal_noun, CiCheck, CiRollup, CiState, CommentThread, ForgeAuthContext, ForgeContext,
    ForgeError, ForgeProvider, ForgeUser, PrComment, PrState, PrSummary, ReviewState,
};

pub struct BitbucketProvider;

#[async_trait]
impl ForgeProvider for BitbucketProvider {
    async fn list_open_prs(&self, ctx: &ForgeContext) -> Result<Vec<PrSummary>, ForgeError> {
        let url = format!(
            "{}/repositories/{}/{}/pullrequests?q=state%3D%22OPEN%22&pagelen=50&fields=values.id,values.title,values.description,values.state,values.draft,values.links,values.source,values.destination,values.author,values.participants,values.updated_on",
            ctx.api_base_url, ctx.remote.owner, ctx.remote.repo
        );
        let response: BitbucketPage<BitbucketPull> =
            ctx.http.get_json(bitbucket_get(ctx, &url)?).await?;
        Ok(response
            .values
            .into_iter()
            .map(|pull| map_pull(pull, ctx.remote.host))
            .collect())
    }

    async fn get_pr(&self, ctx: &ForgeContext, pr_number: u64) -> Result<PrSummary, ForgeError> {
        let url = format!(
            "{}/repositories/{}/{}/pullrequests/{pr_number}",
            ctx.api_base_url, ctx.remote.owner, ctx.remote.repo
        );
        let pull: BitbucketPull = ctx.http.get_json(bitbucket_get(ctx, &url)?).await?;
        Ok(map_pull(pull, ctx.remote.host))
    }

    async fn ci_rollup(&self, ctx: &ForgeContext, pr: &PrSummary) -> Result<CiRollup, ForgeError> {
        let url = format!(
            "{}/repositories/{}/{}/commit/{}/statuses?pagelen=100",
            ctx.api_base_url, ctx.remote.owner, ctx.remote.repo, pr.head_sha
        );
        let response: BitbucketPage<BitbucketBuildStatus> =
            ctx.http.get_json(bitbucket_get(ctx, &url)?).await?;
        let checks = response
            .values
            .into_iter()
            .map(|status| CiCheck {
                name: status
                    .name
                    .or(status.key)
                    .unwrap_or_else(|| "Pipeline".into()),
                state: bitbucket_ci_state(&status.state),
                url: status.url,
            })
            .collect();
        Ok(CiRollup::from_checks(checks))
    }

    async fn comments(
        &self,
        ctx: &ForgeContext,
        pr_number: u64,
    ) -> Result<Vec<CommentThread>, ForgeError> {
        let url = format!(
            "{}/repositories/{}/{}/pullrequests/{pr_number}/comments?pagelen=100",
            ctx.api_base_url, ctx.remote.owner, ctx.remote.repo
        );
        let response: BitbucketPage<BitbucketComment> =
            ctx.http.get_json(bitbucket_get(ctx, &url)?).await?;
        let mut threads = BTreeMap::<u64, CommentThread>::new();
        for comment in response
            .values
            .into_iter()
            .filter(|comment| !comment.deleted)
        {
            let root = comment
                .parent
                .as_ref()
                .map(|parent| parent.id)
                .unwrap_or(comment.id);
            let entry = threads.entry(root).or_insert_with(|| CommentThread {
                id: format!("bitbucket-{root}"),
                resolved: None,
                file: comment
                    .inline
                    .as_ref()
                    .and_then(|inline| inline.path.clone()),
                line: comment
                    .inline
                    .as_ref()
                    .and_then(|inline| inline.to.or(inline.from)),
                comments: Vec::new(),
            });
            entry.comments.push(PrComment {
                author: map_user(comment.user),
                body_markdown: comment.content.raw,
                created_at: comment.created_on,
                url: comment
                    .links
                    .and_then(|links| links.html)
                    .map(|link| link.href),
            });
        }
        Ok(threads.into_values().collect())
    }

    async fn validate_token(&self, ctx: &ForgeAuthContext) -> Result<ForgeUser, ForgeError> {
        let url = format!("{}/user", ctx.api_base_url);
        let username = ctx
            .credentials
            .username
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                ForgeError::Configuration(
                    "Bitbucket API tokens require the Atlassian account email as username".into(),
                )
            })?;
        let request = ctx
            .http
            .get(&url)
            .basic_auth(username, Some(&ctx.credentials.token));
        let user: BitbucketUser = ctx.http.get_json(request).await?;
        Ok(map_user(user))
    }
}

fn bitbucket_get(ctx: &ForgeContext, url: &str) -> Result<reqwest::RequestBuilder, ForgeError> {
    let username = ctx
        .credentials
        .username
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            ForgeError::Configuration(
                "Bitbucket API tokens require the Atlassian account email as username".into(),
            )
        })?;
    Ok(ctx
        .http
        .get(url)
        .basic_auth(username, Some(&ctx.credentials.token)))
}

fn map_pull(pull: BitbucketPull, host: crate::domain::git::host::GitHost) -> PrSummary {
    let state = if pull.draft {
        PrState::Draft
    } else {
        match pull.state.as_str() {
            "MERGED" => PrState::Merged,
            "DECLINED" | "SUPERSEDED" => PrState::Closed,
            _ => PrState::Open,
        }
    };
    let review_state = if pull
        .participants
        .iter()
        .any(|participant| participant.state.as_deref() == Some("changes_requested"))
    {
        ReviewState::ChangesRequested
    } else if pull
        .participants
        .iter()
        .any(|participant| participant.approved)
    {
        ReviewState::Approved
    } else if pull.participants.is_empty() {
        ReviewState::None
    } else {
        ReviewState::Pending
    };
    PrSummary {
        number: pull.id,
        title: pull.title,
        body_markdown: pull.description.unwrap_or_default(),
        state,
        url: pull.links.html.map(|link| link.href).unwrap_or_default(),
        source_branch: pull.source.branch.name,
        target_branch: pull.destination.branch.name,
        head_sha: pull.source.commit.hash,
        review_state,
        author: map_user(pull.author),
        updated_at: pull.updated_on,
        pr_label: proposal_noun(host).into(),
    }
}

fn map_user(user: BitbucketUser) -> ForgeUser {
    ForgeUser {
        username: user
            .nickname
            .or(user.username)
            .unwrap_or_else(|| user.display_name.clone()),
        display_name: Some(user.display_name),
        avatar_url: user
            .links
            .and_then(|links| links.avatar)
            .map(|link| link.href),
    }
}

fn bitbucket_ci_state(state: &str) -> CiState {
    match state {
        "SUCCESSFUL" => CiState::Passing,
        "FAILED" | "STOPPED" => CiState::Failing,
        _ => CiState::Running,
    }
}

#[derive(Deserialize)]
#[serde(bound(deserialize = "T: Deserialize<'de>"))]
struct BitbucketPage<T> {
    #[serde(default)]
    values: Vec<T>,
}

#[derive(Deserialize)]
struct BitbucketPull {
    id: u64,
    title: String,
    description: Option<String>,
    state: String,
    #[serde(default)]
    draft: bool,
    links: BitbucketLinks,
    source: BitbucketPullSide,
    destination: BitbucketPullSide,
    author: BitbucketUser,
    #[serde(default)]
    participants: Vec<BitbucketParticipant>,
    updated_on: String,
}

#[derive(Deserialize)]
struct BitbucketParticipant {
    #[serde(default)]
    approved: bool,
    state: Option<String>,
}

#[derive(Deserialize)]
struct BitbucketPullSide {
    branch: BitbucketBranch,
    commit: BitbucketCommit,
}

#[derive(Deserialize)]
struct BitbucketBranch {
    name: String,
}

#[derive(Deserialize)]
struct BitbucketCommit {
    hash: String,
}

#[derive(Deserialize)]
struct BitbucketUser {
    display_name: String,
    nickname: Option<String>,
    username: Option<String>,
    links: Option<BitbucketLinks>,
}

#[derive(Deserialize)]
struct BitbucketLinks {
    html: Option<BitbucketLink>,
    avatar: Option<BitbucketLink>,
}

#[derive(Deserialize)]
struct BitbucketLink {
    href: String,
}

#[derive(Deserialize)]
struct BitbucketBuildStatus {
    state: String,
    name: Option<String>,
    key: Option<String>,
    url: Option<String>,
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

    #[test]
    fn unknown_bitbucket_status_remains_running() {
        assert_eq!(bitbucket_ci_state("PAUSED"), CiState::Running);
        assert_eq!(bitbucket_ci_state("FAILED"), CiState::Failing);
    }

    #[tokio::test]
    async fn list_open_prs_maps_recorded_fixture_with_api_token_auth() {
        let mut routes = HashMap::new();
        routes.insert(
            "/repositories/acme/repo/pullrequests".into(),
            fixture("bitbucket_pullrequests"),
        );
        let context = context(json_fixture_server(routes).await, GitHost::Bitbucket);

        let pulls = BitbucketProvider
            .list_open_prs(&context)
            .await
            .expect("Bitbucket fixture maps");

        assert_eq!(pulls.len(), 1);
        assert_eq!(pulls[0].number, 9);
        assert_eq!(pulls[0].head_sha, "b".repeat(40));
        assert_eq!(pulls[0].pr_label, "PR");
    }
}
