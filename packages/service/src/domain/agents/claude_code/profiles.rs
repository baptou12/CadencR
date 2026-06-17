//! Claude Code env-var profiles.
//!
//! A profile is a named `{ KEY: VALUE }` map merged on top of the inherited
//! environment when spawning the Claude Code CLI. The reserved name `default`
//! is never stored as a row and always resolves to "inject nothing", so we
//! don't need seeding or cannot-delete constraints in SQL.
//!
//! Active profile name is persisted in the `settings` key/value table under
//! `ACTIVE_PROFILE_KEY`; absent, empty, or `"default"` all mean the default.

use std::collections::HashMap;

use sqlx::SqlitePool;

use crate::domain::workspace::repository::{get_setting, set_setting};
use crate::error::AppError;

pub const DEFAULT_PROFILE_NAME: &str = "default";
pub const ACTIVE_PROFILE_KEY: &str = "claude_code_active_profile";

/// Env keys a profile is never allowed to set. These are process-level
/// injection vectors (dynamic linker, git transports, resolver shim) or
/// host-shadowing vars; accepting them would let a compromised HTTP client
/// hijack the spawned CLI or any tool it invokes.
const DENIED_ENV_KEYS: &[&str] = &[
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "DYLD_FRAMEWORK_PATH",
    "GIT_SSH_COMMAND",
    "GIT_EXEC_PATH",
    "GIT_EXTERNAL_DIFF",
    "PATH",
    "SHELL",
    "NODE_OPTIONS",
    "PYTHONPATH",
    "SSL_CERT_FILE",
    "HOSTALIASES",
];

fn is_denied_env_key(key: &str) -> bool {
    DENIED_ENV_KEYS.iter().any(|d| d.eq_ignore_ascii_case(key))
}

/// Response-only redaction: replace values whose keys look like credentials
/// with `"***"` so DevTools / screenshots / logs don't leak them. The runtime
/// path (`resolve_active_profile_env`) returns the unredacted map directly.
pub fn redact_env_for_response(env: &HashMap<String, String>) -> HashMap<String, String> {
    env.iter()
        .map(|(k, v)| {
            if looks_like_secret_key(k) {
                (k.clone(), "***".to_string())
            } else {
                (k.clone(), v.clone())
            }
        })
        .collect()
}

fn looks_like_secret_key(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    ["TOKEN", "KEY", "SECRET", "PASSWORD", "AUTH", "CREDENTIAL"]
        .iter()
        .any(|needle| upper.contains(needle))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudeCodeProfile {
    pub name: String,
    pub env: HashMap<String, String>,
}

fn parse_env_json(raw: &str) -> Result<HashMap<String, String>, AppError> {
    if raw.trim().is_empty() {
        return Ok(HashMap::new());
    }
    serde_json::from_str::<HashMap<String, String>>(raw)
        .map_err(|e| AppError::DatabaseError(format!("invalid profile env_json: {e}")))
}

fn serialize_env(env: &HashMap<String, String>) -> Result<String, AppError> {
    serde_json::to_string(env)
        .map_err(|e| AppError::Internal(format!("failed to serialize profile env: {e}")))
}

fn validate_profile_name(name: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest(
            "profile name must not be empty".to_string(),
        ));
    }
    if trimmed.eq_ignore_ascii_case(DEFAULT_PROFILE_NAME) {
        return Err(AppError::BadRequest(
            "profile name 'default' is reserved".to_string(),
        ));
    }
    Ok(())
}

pub async fn list_profiles(pool: &SqlitePool) -> Result<Vec<ClaudeCodeProfile>, AppError> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT name, env_json FROM claude_code_profiles ORDER BY name")
            .fetch_all(pool)
            .await?;
    rows.into_iter()
        .map(|(name, raw)| {
            Ok(ClaudeCodeProfile {
                name,
                env: parse_env_json(&raw)?,
            })
        })
        .collect()
}

pub async fn get_profile(
    pool: &SqlitePool,
    name: &str,
) -> Result<Option<ClaudeCodeProfile>, AppError> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT name, env_json FROM claude_code_profiles WHERE name = ?")
            .bind(name)
            .fetch_optional(pool)
            .await?;
    row.map(|(n, raw)| {
        Ok(ClaudeCodeProfile {
            name: n,
            env: parse_env_json(&raw)?,
        })
    })
    .transpose()
}

pub async fn upsert_profile(
    pool: &SqlitePool,
    name: &str,
    env: &HashMap<String, String>,
) -> Result<ClaudeCodeProfile, AppError> {
    validate_profile_name(name)?;
    for key in env.keys() {
        if is_denied_env_key(key) {
            return Err(AppError::BadRequest(format!(
                "env key '{key}' is not allowed in profiles"
            )));
        }
    }
    let env_json = serialize_env(env)?;
    sqlx::query(
        "INSERT INTO claude_code_profiles (name, env_json) VALUES (?, ?) \
         ON CONFLICT(name) DO UPDATE SET env_json = excluded.env_json, updated_at = CURRENT_TIMESTAMP",
    )
    .bind(name)
    .bind(&env_json)
    .execute(pool)
    .await?;
    Ok(ClaudeCodeProfile {
        name: name.to_string(),
        env: env.clone(),
    })
}

pub async fn delete_profile(pool: &SqlitePool, name: &str) -> Result<(), AppError> {
    validate_profile_name(name)?;
    let result = sqlx::query("DELETE FROM claude_code_profiles WHERE name = ?")
        .bind(name)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("profile '{name}' not found")));
    }
    // If the deleted profile was the active one, reset to default.
    if let Some(active) = get_setting(pool, ACTIVE_PROFILE_KEY).await? {
        if active == name {
            set_setting(pool, ACTIVE_PROFILE_KEY, DEFAULT_PROFILE_NAME).await?;
        }
    }
    Ok(())
}

pub async fn get_active_profile_name(pool: &SqlitePool) -> Result<String, AppError> {
    let value = get_setting(pool, ACTIVE_PROFILE_KEY).await?;
    Ok(match value {
        Some(v) if !v.trim().is_empty() => v,
        _ => DEFAULT_PROFILE_NAME.to_string(),
    })
}

pub async fn set_active_profile(pool: &SqlitePool, name: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case(DEFAULT_PROFILE_NAME) {
        set_setting(pool, ACTIVE_PROFILE_KEY, DEFAULT_PROFILE_NAME).await?;
        return Ok(());
    }
    // Ensure the profile exists before activating it.
    if get_profile(pool, trimmed).await?.is_none() {
        return Err(AppError::NotFound(format!("profile '{trimmed}' not found")));
    }
    set_setting(pool, ACTIVE_PROFILE_KEY, trimmed).await?;
    Ok(())
}

/// Resolve the active profile's name and env map.
///
/// The active profile *name* lives in the JSON workspace settings (read via
/// `get_active_profile_name`); only the profile's `env_json` is still
/// SQLite-backed (the `claude_code_profiles` table). Returns `("default", None)`
/// when no non-default profile is active, when the active name points to a
/// deleted profile, or on a DB/parse error. Errors are logged (without values)
/// rather than propagated so a momentary failure can't break agent spawns — the
/// safe fallback is no extra env.
pub async fn resolve_active_profile_env(
    pool: &SqlitePool,
) -> (String, Option<HashMap<String, String>>) {
    let name = match get_active_profile_name(pool).await {
        Ok(name) => name,
        Err(error) => {
            tracing::warn!(%error, "failed to read active claude_code profile name");
            return (DEFAULT_PROFILE_NAME.to_string(), None);
        }
    };
    if name.trim().is_empty() || name.eq_ignore_ascii_case(DEFAULT_PROFILE_NAME) {
        return (DEFAULT_PROFILE_NAME.to_string(), None);
    }

    let row: Result<Option<(Option<String>,)>, _> =
        sqlx::query_as("SELECT env_json FROM claude_code_profiles WHERE name = ?")
            .bind(&name)
            .fetch_optional(pool)
            .await;

    match row {
        Ok(Some((Some(env_json),))) => match parse_env_json(&env_json) {
            Ok(env) if !env.is_empty() => (name, Some(env)),
            Ok(_) => (name, None),
            Err(error) => {
                tracing::warn!(profile = %name, %error, "failed to parse profile env_json");
                (name, None)
            }
        },
        Ok(Some((None,))) => (name, None),
        Ok(None) => {
            tracing::warn!(profile = %name, "active claude_code profile no longer exists");
            (name, None)
        }
        Err(error) => {
            tracing::warn!(profile = %name, %error, "failed to read active claude_code profile env");
            (name, None)
        }
    }
}

pub async fn resolve_profile_env_by_name(
    pool: &SqlitePool,
    name: Option<&str>,
) -> Result<(String, Option<HashMap<String, String>>), AppError> {
    let Some(profile_name) = name.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(resolve_active_profile_env(pool).await);
    };
    if profile_name.eq_ignore_ascii_case(DEFAULT_PROFILE_NAME) {
        return Ok((DEFAULT_PROFILE_NAME.to_string(), None));
    }
    let profile = get_profile(pool, profile_name)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("profile '{profile_name}' not found")))?;
    let env = if profile.env.is_empty() {
        None
    } else {
        Some(profile.env)
    };
    Ok((profile.name, env))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE claude_code_profiles (\
                id INTEGER PRIMARY KEY, \
                name TEXT NOT NULL UNIQUE, \
                env_json TEXT NOT NULL DEFAULT '{}', \
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, \
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP\
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    fn sample_env() -> HashMap<String, String> {
        let mut env = HashMap::new();
        env.insert(
            "ANTHROPIC_BASE_URL".to_string(),
            "https://proxy".to_string(),
        );
        env.insert("CLAUDE_CODE_USE_BEDROCK".to_string(), "1".to_string());
        env
    }

    #[tokio::test]
    async fn upsert_and_list_roundtrip() {
        let pool = setup().await;
        upsert_profile(&pool, "bedrock", &sample_env())
            .await
            .unwrap();
        let profiles = list_profiles(&pool).await.unwrap();
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].name, "bedrock");
        assert_eq!(profiles[0].env, sample_env());
    }

    #[tokio::test]
    async fn upsert_rejects_default_name() {
        let pool = setup().await;
        let err = upsert_profile(&pool, "default", &sample_env())
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[tokio::test]
    async fn upsert_overwrites_existing_env() {
        let pool = setup().await;
        upsert_profile(&pool, "bedrock", &sample_env())
            .await
            .unwrap();
        let mut replacement = HashMap::new();
        replacement.insert("AWS_REGION".to_string(), "us-east-1".to_string());
        upsert_profile(&pool, "bedrock", &replacement)
            .await
            .unwrap();
        let profile = get_profile(&pool, "bedrock").await.unwrap().unwrap();
        assert_eq!(profile.env, replacement);
    }

    #[tokio::test]
    async fn active_env_is_none_for_default() {
        let pool = setup().await;
        let (name, env) = resolve_active_profile_env(&pool).await;
        assert_eq!(name, DEFAULT_PROFILE_NAME);
        assert!(env.is_none());
    }

    #[tokio::test]
    async fn active_env_returns_name_and_env() {
        let pool = setup().await;
        upsert_profile(&pool, "bedrock", &sample_env())
            .await
            .unwrap();
        set_active_profile(&pool, "bedrock").await.unwrap();
        let (name, env) = resolve_active_profile_env(&pool).await;
        assert_eq!(name, "bedrock");
        assert_eq!(env, Some(sample_env()));
    }

    #[tokio::test]
    async fn active_env_for_deleted_profile_logs_and_returns_none() {
        let pool = setup().await;
        // Point to a profile that doesn't exist; the LEFT JOIN yields a row
        // with NULL env_json, which must not crash.
        crate::domain::workspace::repository::set_setting(&pool, ACTIVE_PROFILE_KEY, "ghost")
            .await
            .unwrap();
        let (name, env) = resolve_active_profile_env(&pool).await;
        assert_eq!(name, "ghost");
        assert!(env.is_none());
    }

    #[tokio::test]
    async fn set_active_rejects_unknown_profile() {
        let pool = setup().await;
        let err = set_active_profile(&pool, "bedrock").await.unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[tokio::test]
    async fn deleting_active_profile_resets_to_default() {
        let pool = setup().await;
        upsert_profile(&pool, "bedrock", &sample_env())
            .await
            .unwrap();
        set_active_profile(&pool, "bedrock").await.unwrap();
        delete_profile(&pool, "bedrock").await.unwrap();
        assert_eq!(
            get_active_profile_name(&pool).await.unwrap(),
            DEFAULT_PROFILE_NAME
        );
        let (_, env) = resolve_active_profile_env(&pool).await;
        assert!(env.is_none());
    }

    #[tokio::test]
    async fn delete_missing_profile_is_not_found() {
        let pool = setup().await;
        let err = delete_profile(&pool, "bedrock").await.unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[tokio::test]
    async fn set_active_default_clears_override() {
        let pool = setup().await;
        upsert_profile(&pool, "bedrock", &sample_env())
            .await
            .unwrap();
        set_active_profile(&pool, "bedrock").await.unwrap();
        set_active_profile(&pool, "default").await.unwrap();
        let (_, env) = resolve_active_profile_env(&pool).await;
        assert!(env.is_none());
    }

    #[tokio::test]
    async fn resolve_profile_env_by_name_returns_default_for_default() {
        let pool = setup().await;
        let (name, env) = resolve_profile_env_by_name(&pool, Some("default"))
            .await
            .unwrap();
        assert_eq!(name, DEFAULT_PROFILE_NAME);
        assert_eq!(env, None);
    }

    #[tokio::test]
    async fn resolve_profile_env_by_name_returns_named_env() {
        let pool = setup().await;
        upsert_profile(&pool, "bedrock", &sample_env())
            .await
            .unwrap();

        let (name, env) = resolve_profile_env_by_name(&pool, Some("bedrock"))
            .await
            .unwrap();

        assert_eq!(name, "bedrock");
        assert_eq!(env, Some(sample_env()));
    }

    #[tokio::test]
    async fn resolve_profile_env_by_name_rejects_missing_profile() {
        let pool = setup().await;

        let err = resolve_profile_env_by_name(&pool, Some("missing"))
            .await
            .unwrap_err();

        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[tokio::test]
    async fn upsert_rejects_ld_preload() {
        let pool = setup().await;
        let mut env = HashMap::new();
        env.insert("LD_PRELOAD".into(), "/tmp/evil.so".into());
        let err = upsert_profile(&pool, "evil", &env).await.unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
    }

    #[tokio::test]
    async fn upsert_rejects_path_case_insensitive() {
        let pool = setup().await;
        let mut env = HashMap::new();
        env.insert("path".into(), "/tmp:/usr/bin".into());
        let err = upsert_profile(&pool, "evil", &env).await.unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
    }

    #[tokio::test]
    async fn upsert_rejects_git_ssh_command() {
        let pool = setup().await;
        let mut env = HashMap::new();
        env.insert("GIT_SSH_COMMAND".into(), "sh -c 'curl attacker'".into());
        let err = upsert_profile(&pool, "evil", &env).await.unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
    }

    #[tokio::test]
    async fn upsert_accepts_anthropic_api_key() {
        let pool = setup().await;
        let mut env = HashMap::new();
        env.insert("ANTHROPIC_API_KEY".into(), "sk-ant-live-xxx".into());
        let profile = upsert_profile(&pool, "real", &env).await.unwrap();
        assert_eq!(
            profile.env.get("ANTHROPIC_API_KEY").unwrap(),
            "sk-ant-live-xxx"
        );
    }

    #[test]
    fn redact_hides_secret_like_values() {
        let mut env = HashMap::new();
        env.insert("ANTHROPIC_API_KEY".into(), "sk-live-secret".into());
        env.insert("GITHUB_TOKEN".into(), "ghp_xxx".into());
        env.insert("AUTH_BEARER".into(), "bearer xxx".into());
        env.insert("API_PASSWORD".into(), "hunter2".into());
        env.insert("OAUTH_SECRET".into(), "s3cr3t".into());
        env.insert("AWS_CREDENTIAL_PROVIDER".into(), "iam".into());

        let redacted = redact_env_for_response(&env);
        for (k, v) in &redacted {
            assert_eq!(v, "***", "{k} was not redacted: {v}");
        }
    }

    #[test]
    fn redact_keeps_non_secret_values() {
        let mut env = HashMap::new();
        env.insert("ANTHROPIC_BASE_URL".into(), "https://proxy".into());
        env.insert("AWS_REGION".into(), "us-east-1".into());
        env.insert("CLAUDE_CODE_USE_BEDROCK".into(), "1".into());

        let redacted = redact_env_for_response(&env);
        assert_eq!(redacted.get("ANTHROPIC_BASE_URL").unwrap(), "https://proxy");
        assert_eq!(redacted.get("AWS_REGION").unwrap(), "us-east-1");
        assert_eq!(redacted.get("CLAUDE_CODE_USE_BEDROCK").unwrap(), "1");
    }

    #[test]
    fn redact_is_case_insensitive() {
        let mut env = HashMap::new();
        env.insert("lowercase_token".into(), "v".into());
        env.insert("MixedCase_Key".into(), "v".into());
        let redacted = redact_env_for_response(&env);
        assert_eq!(redacted.get("lowercase_token").unwrap(), "***");
        assert_eq!(redacted.get("MixedCase_Key").unwrap(), "***");
    }
}
