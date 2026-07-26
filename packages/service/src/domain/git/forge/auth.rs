use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use cli_discovery::{discover_all, select_best, DiscoverySpec};
use serde::{Deserialize, Serialize};
use tokio::sync::{OnceCell, RwLock};

use super::provider::{ForgeAuthSource, ForgeCredentials, ForgeError, ForgeHostConfig};
use crate::domain::git::host::GitHost;
use crate::error::AppError;

pub const FORGE_HOSTS_SETTING: &str = "forge_hosts";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredCredential {
    token: String,
    username: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct TokenDocument {
    tokens: BTreeMap<String, StoredCredential>,
}

pub struct ForgeAuthStore {
    path: PathBuf,
    document: RwLock<Option<TokenDocument>>,
}

impl Default for ForgeAuthStore {
    fn default() -> Self {
        Self::new(forge_data_dir().join("tokens.json"))
    }
}

impl ForgeAuthStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            document: RwLock::new(None),
        }
    }

    pub async fn stored_credentials(
        &self,
        hostname: &str,
    ) -> Result<Option<ForgeCredentials>, ForgeError> {
        let hostname = normalize_hostname(hostname)?;
        let document = self.document().await?;
        Ok(document
            .tokens
            .get(&hostname)
            .cloned()
            .map(|stored| ForgeCredentials {
                token: stored.token,
                username: stored.username,
                source: ForgeAuthSource::Stored,
            }))
    }

    pub async fn save(
        &self,
        hostname: &str,
        token: &str,
        username: Option<String>,
    ) -> Result<(), ForgeError> {
        let hostname = normalize_hostname(hostname)?;
        let token = token.trim();
        if token.is_empty() {
            return Err(ForgeError::Authentication(
                "Forge token cannot be empty".into(),
            ));
        }
        let mut cached = self.document.write().await;
        let document = load_document(&self.path, &mut cached)?;
        document.tokens.insert(
            hostname,
            StoredCredential {
                token: token.to_string(),
                username: normalized_optional(username),
            },
        );
        write_document(&self.path, document)
    }

    pub async fn delete(&self, hostname: &str) -> Result<bool, ForgeError> {
        let hostname = normalize_hostname(hostname)?;
        let mut cached = self.document.write().await;
        let document = load_document(&self.path, &mut cached)?;
        let removed = document.tokens.remove(&hostname).is_some();
        if removed {
            write_document(&self.path, document)?;
        }
        Ok(removed)
    }

    async fn document(&self) -> Result<TokenDocument, ForgeError> {
        if let Some(document) = self.document.read().await.as_ref() {
            return Ok(document.clone());
        }
        let mut cached = self.document.write().await;
        Ok(load_document(&self.path, &mut cached)?.clone())
    }
}

pub fn host_configs() -> Result<BTreeMap<String, ForgeHostConfig>, AppError> {
    let Some(value) = crate::domain::settings_store::global_get(FORGE_HOSTS_SETTING) else {
        return Ok(BTreeMap::new());
    };
    serde_json::from_str(&value)
        .map_err(|error| AppError::Internal(format!("parse forge host settings: {error}")))
}

pub async fn save_host_config(hostname: &str, config: ForgeHostConfig) -> Result<(), AppError> {
    let hostname = normalize_hostname(hostname).map_err(forge_to_app_error)?;
    let mut configs = host_configs()?;
    configs.insert(hostname, config);
    let value = serde_json::to_string(&configs)
        .map_err(|error| AppError::Internal(format!("serialize forge settings: {error}")))?;
    crate::domain::settings_store::global_set(FORGE_HOSTS_SETTING, &value).await
}

pub async fn resolve_credentials(
    store: &ForgeAuthStore,
    hostname: &str,
    kind: GitHost,
    config: Option<&ForgeHostConfig>,
) -> Result<Option<ForgeCredentials>, ForgeError> {
    if let Some(mut stored) = store.stored_credentials(hostname).await? {
        if stored.username.is_none() {
            stored.username = config.and_then(|value| value.username.clone());
        }
        return Ok(Some(stored));
    }
    if !config.is_some_and(|value| value.use_cli_auth) {
        return Ok(None);
    }
    let token = match kind {
        GitHost::GitHub => cli_token("gh", &["auth", "token", "--hostname", hostname]).await?,
        GitHost::GitLab => {
            let output = cli_token(
                "glab",
                &["auth", "status", "--hostname", hostname, "--show-token"],
            )
            .await?;
            parse_glab_token(&output).unwrap_or(output)
        }
        GitHost::Bitbucket => {
            return Err(ForgeError::Configuration(
                "Bitbucket has no supported CLI token source; enter an API token".into(),
            ))
        }
        GitHost::Other => {
            return Err(ForgeError::Configuration(
                "Choose a forge kind for this self-hosted remote".into(),
            ))
        }
    };
    if token.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(ForgeCredentials {
        token: token.trim().to_string(),
        username: config.and_then(|value| value.username.clone()),
        source: ForgeAuthSource::Cli,
    }))
}

pub fn normalize_hostname(hostname: &str) -> Result<String, ForgeError> {
    let hostname = hostname.trim().trim_end_matches('.').to_ascii_lowercase();
    let invalid = hostname.is_empty()
        || hostname.contains('/')
        || hostname.contains('@')
        || hostname.contains(char::is_whitespace)
        || hostname.starts_with('-');
    if invalid {
        return Err(ForgeError::Configuration(
            "Forge hostname is invalid".into(),
        ));
    }
    Ok(hostname)
}

/// A forge failure as an HTTP answer: 4xx when the user has to change something,
/// 5xx when the forge or the network is having a moment.
///
/// That is the same question [`ForgeError::is_setup_failure`] answers for the PR
/// pane, so it is asked once here rather than kept as a second exhaustive match
/// that has to be remembered whenever a variant is added.
pub fn forge_to_app_error(error: ForgeError) -> AppError {
    if error.is_setup_failure() {
        AppError::BadRequest(error.to_string())
    } else {
        AppError::Internal(error.to_string())
    }
}

async fn cli_token(binary: &'static str, args: &[&str]) -> Result<String, ForgeError> {
    let path = discover_forge_cli(binary).await?;
    let output = tokio::process::Command::new(&path)
        .args(args)
        .env("NO_COLOR", "1")
        .output()
        .await
        .map_err(|error| {
            ForgeError::Configuration(format!(
                "Could not run {binary} for forge authentication: {error}"
            ))
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ForgeError::Authentication(format!(
            "{binary} did not return an authenticated token: {}",
            stderr.trim()
        )));
    }
    String::from_utf8(output.stdout)
        .map(|value| value.trim().to_string())
        .map_err(|_| ForgeError::Authentication(format!("{binary} returned a non-UTF-8 token")))
}

static GH_CLI_PATH: OnceCell<PathBuf> = OnceCell::const_new();
static GLAB_CLI_PATH: OnceCell<PathBuf> = OnceCell::const_new();

async fn discover_forge_cli(binary: &'static str) -> Result<PathBuf, ForgeError> {
    let cache = match binary {
        "gh" => &GH_CLI_PATH,
        "glab" => &GLAB_CLI_PATH,
        _ => {
            return Err(ForgeError::Configuration(format!(
                "Unsupported forge CLI: {binary}"
            )))
        }
    };
    let discovered = cache
        .get_or_try_init(|| async move {
            let spec = DiscoverySpec {
                bin_name: binary,
                well_known_relative_to_home: vec![".local/bin"],
                well_known_absolute: vec!["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"],
                version_args: &["--version"],
                version_must_contain: Some(binary),
            };
            let candidates = discover_all(&spec, None).await;
            select_best(&candidates).map(|candidate| candidate.path.clone())
                .ok_or_else(|| {
                    ForgeError::Configuration(format!(
                        "Could not find the {binary} CLI in PATH, the login-shell PATH, or common install directories"
                    ))
                })
        })
        .await?;
    Ok(discovered.clone())
}

fn parse_glab_token(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let line = line.trim();
        let (_, value) = line
            .split_once("Token:")
            .or_else(|| line.split_once("token:"))?;
        let token = value.trim().trim_matches('\'').trim_matches('"');
        (!token.is_empty()).then(|| token.to_string())
    })
}

fn read_document(path: &Path) -> Result<TokenDocument, ForgeError> {
    if !path.exists() {
        return Ok(TokenDocument::default());
    }
    crate::remote::secure_fs::ensure_owner_only(path)
        .map_err(|error| ForgeError::Configuration(format!("secure forge token file: {error}")))?;
    let bytes = std::fs::read(path)
        .map_err(|error| ForgeError::Configuration(format!("read forge token file: {error}")))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| ForgeError::Configuration(format!("parse forge token file: {error}")))
}

fn load_document<'a>(
    path: &Path,
    cached: &'a mut Option<TokenDocument>,
) -> Result<&'a mut TokenDocument, ForgeError> {
    if cached.is_none() {
        *cached = Some(read_document(path)?);
    }
    Ok(cached.as_mut().expect("forge token document initialized"))
}

fn write_document(path: &Path, document: &TokenDocument) -> Result<(), ForgeError> {
    let parent = path.parent().ok_or_else(|| {
        ForgeError::Configuration("Forge token file has no parent directory".into())
    })?;
    crate::remote::secure_fs::create_dir_owner_only(parent)
        .map_err(|error| ForgeError::Configuration(format!("create forge token dir: {error}")))?;
    let bytes = serde_json::to_vec_pretty(document).map_err(|error| {
        ForgeError::Configuration(format!("serialize forge token file: {error}"))
    })?;
    crate::remote::secure_fs::write_secret(path, &bytes)
        .map_err(|error| ForgeError::Configuration(format!("write forge token file: {error}")))
}

fn forge_data_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".cadencr")
        .join("forge")
}

pub(super) fn normalized_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let value = value.trim().to_string();
        (!value.is_empty()).then_some(value)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn token_store_round_trips_and_deletes() {
        let dir = tempfile::tempdir().unwrap();
        let store = ForgeAuthStore::new(dir.path().join("forge/tokens.json"));
        store.save("GitHub.COM", "secret", None).await.unwrap();
        let credentials = store
            .stored_credentials("github.com")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(credentials.token, "secret");
        assert_eq!(credentials.source, ForgeAuthSource::Stored);
        assert!(store.delete("github.com").await.unwrap());
        assert!(store
            .stored_credentials("github.com")
            .await
            .unwrap()
            .is_none());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn token_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("forge/tokens.json");
        let store = ForgeAuthStore::new(path.clone());
        store.save("github.com", "secret", None).await.unwrap();
        assert_eq!(
            std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn parses_glab_status_token() {
        assert_eq!(
            parse_glab_token("✓ Logged in\n  Token: glpat-example\n").as_deref(),
            Some("glpat-example")
        );
    }
}
