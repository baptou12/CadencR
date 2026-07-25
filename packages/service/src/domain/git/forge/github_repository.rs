use serde::Deserialize;

use super::github::github_get;
use super::provider::{ForgeContext, ForgeError};

pub(super) struct PullRepo {
    pub(super) api_full_name: String,
    pub(super) head_full_name: Option<String>,
}

pub(super) async fn resolve_pull_repo(ctx: &ForgeContext) -> Result<PullRepo, ForgeError> {
    let full_name = format!("{}/{}", ctx.remote.owner, ctx.remote.repo);
    let url = format!("{}/repos/{full_name}", ctx.api_base_url);
    let repo: GitHubRepo = ctx.http.request_json(github_get(ctx, &url)).await?;
    if repo.fork {
        if let Some(parent) = repo.parent {
            return Ok(PullRepo {
                api_full_name: parent.full_name,
                head_full_name: Some(repo.full_name),
            });
        }
    }
    Ok(PullRepo {
        api_full_name: repo.full_name,
        head_full_name: None,
    })
}

#[derive(Deserialize)]
struct GitHubRepo {
    full_name: String,
    #[serde(default)]
    fork: bool,
    parent: Option<GitHubRepoParent>,
}

#[derive(Deserialize)]
struct GitHubRepoParent {
    full_name: String,
}
