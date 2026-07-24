use std::fmt;
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::http::ForgeHttp;
use crate::domain::git::host::{GitHost, RemoteInfo};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PrState {
    Open,
    Draft,
    Merged,
    Closed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReviewState {
    Approved,
    ChangesRequested,
    Pending,
    None,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ForgeUser {
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PrSummary {
    pub number: u64,
    pub title: String,
    pub body_markdown: String,
    pub state: PrState,
    pub url: String,
    pub source_branch: String,
    pub target_branch: String,
    pub head_sha: String,
    pub review_state: ReviewState,
    pub author: ForgeUser,
    pub updated_at: String,
    /// Provider-neutral display noun. Values are currently `PR` and `MR`.
    pub pr_label: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CiState {
    None,
    Running,
    Passing,
    Failing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CiCheck {
    pub name: String,
    pub state: CiState,
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CiRollup {
    pub state: CiState,
    pub checks: Vec<CiCheck>,
}

impl CiRollup {
    pub fn from_checks(checks: Vec<CiCheck>) -> Self {
        let state = if checks.is_empty() {
            CiState::None
        } else if checks.iter().any(|check| check.state == CiState::Failing) {
            CiState::Failing
        } else if checks.iter().any(|check| check.state == CiState::Running) {
            CiState::Running
        } else {
            CiState::Passing
        };
        Self { state, checks }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PrComment {
    pub author: ForgeUser,
    pub body_markdown: String,
    pub created_at: String,
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct CommentThread {
    pub id: String,
    pub resolved: Option<bool>,
    pub file: Option<String>,
    pub line: Option<u64>,
    pub comments: Vec<PrComment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PrCommentsResponse {
    pub feature_id: i64,
    pub threads: Vec<CommentThread>,
    pub fetched_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct PrStatusSnapshot {
    pub feature_id: i64,
    pub pr: Option<PrSummary>,
    pub ci: Option<CiRollup>,
    pub fetched_at: i64,
    pub error: Option<String>,
    pub auth_required: bool,
}

impl PrStatusSnapshot {
    pub fn semantic_eq(&self, other: &Self) -> bool {
        self.feature_id == other.feature_id
            && self.pr == other.pr
            && self.ci == other.ci
            && self.error == other.error
            && self.auth_required == other.auth_required
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ForgeAuthSource {
    Stored,
    Cli,
}

#[derive(Debug, Clone)]
pub struct ForgeCredentials {
    pub token: String,
    pub username: Option<String>,
    pub source: ForgeAuthSource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ForgeHostConfig {
    pub kind: GitHost,
    pub api_base_url: Option<String>,
    #[serde(default)]
    pub use_cli_auth: bool,
    pub username: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ForgeAuthStatus {
    pub hostname: String,
    pub kind: GitHost,
    pub api_base_url: Option<String>,
    /// Whether an explicit token is persisted in the owner-only forge secret file.
    pub token_present: bool,
    pub source: Option<ForgeAuthSource>,
    pub validated_user: Option<ForgeUser>,
    pub error: Option<String>,
    pub use_cli_auth: bool,
    /// Whether this host kind supports opt-in token reuse from an installed CLI.
    pub cli_auth_available: bool,
    /// Whether manual API-token authentication also requires a username.
    pub username_required: bool,
    pub username: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ForgeTokenRequest {
    pub hostname: String,
    pub kind: GitHost,
    pub api_base_url: Option<String>,
    /// Manual API token. Omit when opting into `gh` / `glab` CLI reuse.
    pub token: Option<String>,
    /// Bitbucket Cloud API-token username (normally the Atlassian account email).
    pub username: Option<String>,
    #[serde(default)]
    pub use_cli_auth: bool,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct ForgeTokenDeleteParams {
    pub hostname: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ForgeTokenDeleteResponse {
    pub deleted: bool,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct FeaturePrParams {
    pub feature_id: i64,
}

#[derive(Clone)]
pub struct ForgeContext {
    pub remote: RemoteInfo,
    pub api_base_url: String,
    pub credentials: ForgeCredentials,
    pub http: Arc<ForgeHttp>,
}

#[derive(Clone)]
pub struct ForgeAuthContext {
    pub api_base_url: String,
    pub credentials: ForgeCredentials,
    pub http: Arc<ForgeHttp>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForgeError {
    Authentication(String),
    Configuration(String),
    Http(String),
    RateLimited(String),
    Response(String),
}

impl fmt::Display for ForgeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::Authentication(message)
            | Self::Configuration(message)
            | Self::Http(message)
            | Self::RateLimited(message)
            | Self::Response(message) => message,
        };
        f.write_str(message)
    }
}

impl std::error::Error for ForgeError {}

#[async_trait]
pub trait ForgeProvider: Send + Sync {
    async fn list_open_prs(&self, ctx: &ForgeContext) -> Result<Vec<PrSummary>, ForgeError>;
    async fn get_pr(&self, ctx: &ForgeContext, pr_number: u64) -> Result<PrSummary, ForgeError>;
    async fn ci_rollup(&self, ctx: &ForgeContext, pr: &PrSummary) -> Result<CiRollup, ForgeError>;
    async fn comments(
        &self,
        ctx: &ForgeContext,
        pr_number: u64,
    ) -> Result<Vec<CommentThread>, ForgeError>;
    async fn validate_token(&self, ctx: &ForgeAuthContext) -> Result<ForgeUser, ForgeError>;
}

pub fn proposal_noun(host: GitHost) -> &'static str {
    match host {
        GitHost::GitLab => "MR",
        GitHost::GitHub | GitHost::Bitbucket | GitHost::Other => "PR",
    }
}
