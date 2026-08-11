//! Version probing and semver parsing.

use std::path::Path;
use std::time::Duration;

use once_cell::sync::OnceCell;
use regex_lite::Regex;
use tokio::process::Command;

use crate::types::VersionKey;

/// Parse a semver triple out of a free-form `--version` string. Returns the
/// first match. Useful for both Claude (`1.2.3 (Claude Code)`) and OpenCode
/// (`opencode 1.4.3`).
pub fn parse_version_string(raw: &str) -> Option<VersionKey> {
    static MATCHER: OnceCell<Regex> = OnceCell::new();
    let regex = MATCHER.get_or_init(|| {
        Regex::new(r"\b(\d+)\.(\d+)\.(\d+)\b").expect("static semver regex compiles")
    });
    let captures = regex.captures(raw)?;
    Some(VersionKey(
        captures.get(1)?.as_str().parse().ok()?,
        captures.get(2)?.as_str().parse().ok()?,
        captures.get(3)?.as_str().parse().ok()?,
    ))
}

pub async fn query_version(command: &Path, args: &[&str]) -> Option<VersionKey> {
    let args: Vec<String> = args.iter().map(|arg| (*arg).to_string()).collect();
    probe_version(command, &args).await.and_then(|(v, _)| v)
}

/// Probe `command --args[..]` and return `(parsed_version, raw_output)`.
///
/// Returns `None` only when the subprocess itself fails (timeout, spawn
/// error). A successful run with un-parseable output returns
/// `Some((None, "..."))` so callers can still inspect the text for filters
/// (e.g. the `version_must_contain` shim guard).
pub(crate) async fn probe_version(
    command: &Path,
    args: &[String],
) -> Option<(Option<VersionKey>, String)> {
    let output = tokio::time::timeout(
        Duration::from_secs(5),
        Command::new(command).args(args).kill_on_drop(true).output(),
    )
    .await
    .ok()?
    .ok()?;

    // Combine streams so a single regex pass + single substring check
    // covers tools that print to either (rustup prints to stderr).
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let version = parse_version_string(&combined);
    Some((version, combined))
}

pub(crate) fn contains_ci(haystack: &str, needle: &str) -> bool {
    haystack.to_lowercase().contains(&needle.to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests_support::make_executable_with_body;
    use tempfile::TempDir;

    #[test]
    fn parses_semver_anywhere_in_string() {
        assert_eq!(
            parse_version_string("opencode 1.4.3"),
            Some(VersionKey(1, 4, 3))
        );
        assert_eq!(
            parse_version_string("ERROR service=models.dev\n1.1.65\n"),
            Some(VersionKey(1, 1, 65))
        );
        assert_eq!(parse_version_string("no version here"), None);
    }

    #[tokio::test]
    async fn query_version_extracts_semver() {
        let dir = TempDir::new().unwrap();
        let path =
            make_executable_with_body(dir.path(), "thing", "#!/bin/sh\necho '2.7.1 build'\n");
        let version = query_version(&path, &["--version"]).await;
        assert_eq!(version, Some(VersionKey(2, 7, 1)));
    }
}
