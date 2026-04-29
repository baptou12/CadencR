//! Provider-neutral CLI binary discovery for the host service.
//!
//! - Persists user-selected paths under two well-known global settings keys.
//! - At startup, pushes those paths into the SDK-level overrides so subsequent
//!   spawns honor them.
//! - Exposes `GET /api/agents/binary-discovery` so onboarding can render a
//!   picker over every candidate `claude` and `opencode` install on disk.

pub mod routes;

use std::path::PathBuf;

use sqlx::SqlitePool;
use tracing::info;

use super::adapter::RuntimeError;

/// Global settings key for the user-selected `claude` CLI path.
pub const CLAUDE_CLI_PATH_KEY: &str = "claude_cli_path";
/// Global settings key for the user-selected `opencode` CLI path.
pub const OPENCODE_CLI_PATH_KEY: &str = "opencode_cli_path";

/// Read both per-provider override paths from the global settings table and
/// install them into the SDK-level overrides. Called once at app boot, before
/// any adapter starts spawning processes.
///
/// Errors reading settings are swallowed (with a tracing log) so a borked DB
/// doesn't block startup — discovery still falls through to PATH walking +
/// well-known dirs, exactly like the no-override case.
pub async fn apply_binary_overrides_from_settings(read_pool: &SqlitePool) {
    let (claude, opencode) = read_overrides(read_pool).await;
    if let Some(path) = claude {
        info!(path = %path.display(), "applying claude CLI override from settings");
        claude_agent_sdk_rs::set_binary_override(Some(path));
    }
    if let Some(path) = opencode {
        info!(path = %path.display(), "applying opencode CLI override from settings");
        opencode_sdk_rs::set_binary_override(Some(path));
    }
}

/// Single-pass read of both override settings. Used by both startup wiring and
/// the discovery HTTP handler so we don't hit SQLite four times for two values.
pub(crate) async fn read_overrides(read_pool: &SqlitePool) -> (Option<PathBuf>, Option<PathBuf>) {
    let (claude, opencode) = tokio::join!(
        read_override_setting(read_pool, CLAUDE_CLI_PATH_KEY),
        read_override_setting(read_pool, OPENCODE_CLI_PATH_KEY),
    );
    (claude, opencode)
}

async fn read_override_setting(read_pool: &SqlitePool, key: &str) -> Option<PathBuf> {
    match crate::domain::workspace::repository::get_nonempty_setting(read_pool, key).await {
        Ok(value) => value.map(PathBuf::from),
        Err(error) => {
            tracing::warn!(key, %error, "failed to read CLI binary override from settings");
            None
        }
    }
}

/// User-facing message for `RuntimeError::CliNotFound`, surfaced via the WS
/// error envelope when an agent fails to spawn. Returns `None` for any other
/// error variant.
pub fn cli_not_found_message(error: &RuntimeError) -> Option<String> {
    let RuntimeError::CliNotFound { provider, searched } = error else {
        return None;
    };
    let dirs = searched
        .iter()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    let suffix = if dirs.is_empty() {
        String::new()
    } else {
        format!("\nSearched: {dirs}")
    };
    Some(format!(
        "Could not find the `{provider}` CLI binary. Open Settings → Binary Path to point Cadencr at your install.{suffix}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_pool_with_settings() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    #[tokio::test]
    async fn read_override_setting_returns_none_for_empty_string() {
        let pool = test_pool_with_settings().await;
        sqlx::query("INSERT INTO settings (key, value) VALUES ('claude_cli_path', '')")
            .execute(&pool)
            .await
            .unwrap();
        assert!(read_override_setting(&pool, CLAUDE_CLI_PATH_KEY)
            .await
            .is_none());
    }

    #[tokio::test]
    async fn read_overrides_returns_both_values_in_one_pass() {
        let pool = test_pool_with_settings().await;
        sqlx::query(
            "INSERT INTO settings (key, value) VALUES \
             ('claude_cli_path', '/c/claude'), ('opencode_cli_path', '/o/opencode')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let (claude, opencode) = read_overrides(&pool).await;
        assert_eq!(claude, Some(PathBuf::from("/c/claude")));
        assert_eq!(opencode, Some(PathBuf::from("/o/opencode")));
    }

    #[test]
    fn cli_not_found_message_includes_provider_and_searched_dirs() {
        let error = RuntimeError::cli_not_found(
            "claude",
            vec![
                PathBuf::from("/usr/bin"),
                PathBuf::from("/opt/homebrew/bin"),
            ],
        );
        let message = cli_not_found_message(&error).expect("message");
        assert!(message.contains("claude"));
        assert!(message.contains("/usr/bin"));
        assert!(message.contains("/opt/homebrew/bin"));
    }

    #[test]
    fn cli_not_found_message_omits_searched_section_when_empty() {
        let error = RuntimeError::cli_not_found("claude", vec![]);
        let message = cli_not_found_message(&error).expect("message");
        assert!(!message.contains("Searched"));
    }

    #[test]
    fn cli_not_found_message_returns_none_for_generic_error() {
        let error = RuntimeError::new("oops");
        assert!(cli_not_found_message(&error).is_none());
    }
}
