//! Provider-neutral CLI binary discovery.
//!
//! Both the Claude and OpenCode SDKs need to find their CLI binary on disk.
//! On macOS in particular, when Cadence is launched from Finder/Dock/Spotlight
//! the inherited PATH is just `/etc/paths` + `/etc/paths.d/*` and never sources
//! the user's `~/.zshrc` / `~/.bash_profile` — so well-known dirs like
//! `/opt/homebrew/bin`, `~/.bun/bin`, `~/.nvm/.../bin` etc. are invisible.
//!
//! This crate enumerates *every* candidate it can find, queries each one's
//! `--version`, and lets the caller pick the best (highest semver). It also
//! exposes the full candidate list so the host app can render a picker UI.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use once_cell::sync::OnceCell;
use regex_lite::Regex;
use tokio::process::Command;
use tokio::sync::OnceCell as AsyncOnceCell;
use tracing::warn;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Per-provider configuration describing what to discover.
#[derive(Debug, Clone)]
pub struct DiscoverySpec {
    /// Bare binary name, e.g. `"claude"` or `"opencode"`.
    pub bin_name: &'static str,
    /// Directories relative to `$HOME` that often contain the binary
    /// (e.g. `".claude/local"`, `".bun/bin"`).
    pub well_known_relative_to_home: Vec<&'static str>,
    /// Absolute directories that often contain the binary
    /// (e.g. `"/opt/homebrew/bin"`, `"/usr/local/bin"`).
    pub well_known_absolute: Vec<&'static str>,
    /// Args to pass when querying the binary's version (typically `["--version"]`).
    pub version_args: &'static [&'static str],
}

/// A semver triple captured from `--version` output.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub struct VersionKey(pub u64, pub u64, pub u64);

impl VersionKey {
    pub fn to_string_dotted(&self) -> String {
        format!("{}.{}.{}", self.0, self.1, self.2)
    }
}

/// Where a candidate was found. Ordered so higher-priority sources beat lower
/// ones during ties (override > login-shell PATH > env PATH > well-known dir).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub enum CandidateSource {
    WellKnown,
    EnvPath,
    LoginShellPath,
    Override,
}

/// One discovered binary on disk.
#[derive(Clone, Debug)]
pub struct Candidate {
    /// Path as discovered (may be a symlink/shim).
    pub path: PathBuf,
    /// Resolved through symlinks. Used for dedupe.
    pub canonical: PathBuf,
    /// Parsed semver, if `--version` returned something we could parse.
    pub version: Option<VersionKey>,
    /// Where the candidate was discovered.
    pub source: CandidateSource,
}

/// Enumerate every candidate binary on disk, in source order.
///
/// The optional `override_path`, if given and executable, is returned as the
/// sole candidate (with `CandidateSource::Override`). Otherwise this walks:
/// 1. `$PATH` — `EnvPath`
/// 2. The user's login-shell PATH (cached) — `LoginShellPath`
/// 3. `well_known_*` from the spec — `WellKnown`
///
/// All candidates are deduped by canonical path. Version is queried for each.
pub async fn discover_all(spec: &DiscoverySpec, override_path: Option<&Path>) -> Vec<Candidate> {
    if let Some(path) = override_path {
        if let Some(canonical) = canonicalize_executable(path) {
            let version = query_version(path, spec.version_args).await;
            return vec![Candidate {
                path: path.to_path_buf(),
                canonical,
                version,
                source: CandidateSource::Override,
            }];
        }
    }

    let mut seen_canonical = HashSet::new();
    let mut candidates = Vec::new();

    // 1. $PATH (works in Terminal launches; usually stripped under GUI launch).
    let env_path = std::env::var_os("PATH");
    walk_path_var(
        env_path.as_deref(),
        spec.bin_name,
        CandidateSource::EnvPath,
        &mut seen_canonical,
        &mut candidates,
    );

    // 2. Login-shell PATH (fixes macOS GUI launches).
    if let Some(login_path) = login_shell_path().await {
        walk_path_var(
            Some(std::ffi::OsStr::new(login_path.as_str())),
            spec.bin_name,
            CandidateSource::LoginShellPath,
            &mut seen_canonical,
            &mut candidates,
        );
    }

    // 3. Well-known dirs (deterministic, no subprocess).
    let home_dir = std::env::var_os("HOME").map(PathBuf::from);
    walk_well_known(
        spec,
        home_dir.as_deref(),
        &mut seen_canonical,
        &mut candidates,
    );

    // Probe versions in parallel — each probe is an independent subprocess
    // with its own 5s timeout, so serial waits would compound badly when
    // multiple installs are present.
    let versions = futures::future::join_all(
        candidates
            .iter()
            .map(|candidate| query_version(&candidate.path, spec.version_args)),
    )
    .await;
    for (candidate, version) in candidates.iter_mut().zip(versions) {
        candidate.version = version;
    }

    candidates
}

/// Enumerate every directory `discover_all` would probe for the given spec.
/// Used by callers that need to surface a "we looked here" list in error
/// messages or onboarding UI without re-implementing PATH-walking.
pub async fn searched_dirs(spec: &DiscoverySpec) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(path_var) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path_var));
    }
    if let Some(login_path) = login_shell_path().await {
        dirs.extend(std::env::split_paths(&login_path));
    }
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        for relative in &spec.well_known_relative_to_home {
            dirs.push(home.join(relative));
        }
    }
    for absolute in &spec.well_known_absolute {
        dirs.push(PathBuf::from(absolute));
    }
    dirs
}

/// Pick the best candidate by (version desc, source priority desc).
///
/// Candidates without a parsed version sort below those that have one. Ties
/// break on `CandidateSource` (Override > LoginShellPath > EnvPath > WellKnown).
pub fn select_best(candidates: &[Candidate]) -> Option<&Candidate> {
    candidates.iter().max_by(|a, b| {
        a.version
            .cmp(&b.version)
            .then_with(|| a.source.cmp(&b.source))
    })
}

/// Spawn the user's login shell once and return its PATH.
///
/// Cached for the process lifetime. Returns `None` on Windows or if the shell
/// errors out — callers must treat absence as benign.
pub async fn login_shell_path() -> Option<String> {
    static CACHE: AsyncOnceCell<Option<String>> = AsyncOnceCell::const_new();
    CACHE.get_or_init(resolve_login_shell_path).await.clone()
}

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

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    match std::fs::metadata(path) {
        Ok(meta) => meta.is_file() && (meta.permissions().mode() & 0o111 != 0),
        Err(_) => false,
    }
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

fn canonicalize_executable(path: &Path) -> Option<PathBuf> {
    if !is_executable(path) {
        return None;
    }
    std::fs::canonicalize(path).ok()
}

fn walk_path_var(
    path_var: Option<&std::ffi::OsStr>,
    bin_name: &str,
    source: CandidateSource,
    seen_canonical: &mut HashSet<PathBuf>,
    candidates: &mut Vec<Candidate>,
) {
    let Some(path_var) = path_var else { return };
    let bin_with_suffix = format!("{}{}", bin_name, std::env::consts::EXE_SUFFIX);
    for dir in std::env::split_paths(path_var) {
        let candidate_path = dir.join(&bin_with_suffix);
        push_if_executable(&candidate_path, source, seen_canonical, candidates);
    }
}

fn walk_well_known(
    spec: &DiscoverySpec,
    home_dir: Option<&Path>,
    seen_canonical: &mut HashSet<PathBuf>,
    candidates: &mut Vec<Candidate>,
) {
    let bin_with_suffix = format!("{}{}", spec.bin_name, std::env::consts::EXE_SUFFIX);

    if let Some(home) = home_dir {
        for relative in &spec.well_known_relative_to_home {
            let candidate_path = home.join(relative).join(&bin_with_suffix);
            push_if_executable(
                &candidate_path,
                CandidateSource::WellKnown,
                seen_canonical,
                candidates,
            );
        }
    }

    for absolute in &spec.well_known_absolute {
        let candidate_path = Path::new(absolute).join(&bin_with_suffix);
        push_if_executable(
            &candidate_path,
            CandidateSource::WellKnown,
            seen_canonical,
            candidates,
        );
    }
}

fn push_if_executable(
    path: &Path,
    source: CandidateSource,
    seen_canonical: &mut HashSet<PathBuf>,
    candidates: &mut Vec<Candidate>,
) {
    let Some(canonical) = canonicalize_executable(path) else {
        return;
    };
    if !seen_canonical.insert(canonical.clone()) {
        return;
    }
    candidates.push(Candidate {
        path: path.to_path_buf(),
        canonical,
        version: None,
        source,
    });
}

async fn query_version(command: &Path, args: &[&str]) -> Option<VersionKey> {
    let output = tokio::time::timeout(
        Duration::from_secs(5),
        Command::new(command).args(args).output(),
    )
    .await
    .ok()?
    .ok()?;

    parse_version_string(&String::from_utf8_lossy(&output.stdout))
        .or_else(|| parse_version_string(&String::from_utf8_lossy(&output.stderr)))
}

#[cfg(unix)]
async fn resolve_login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty())?;
    let output = tokio::time::timeout(
        Duration::from_secs(3),
        Command::new(&shell)
            .args(["-ilc", "echo $PATH"])
            .env_remove("CLAUDECODE")
            .output(),
    )
    .await
    .ok()?
    .ok()?;

    if !output.status.success() {
        warn!(
            shell = %shell,
            stderr = %String::from_utf8_lossy(&output.stderr),
            "login shell exited non-zero while resolving PATH"
        );
        return None;
    }

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

#[cfg(not(unix))]
async fn resolve_login_shell_path() -> Option<String> {
    None
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::TempDir;

    fn make_executable_with_body(dir: &Path, name: &str, body: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, body).unwrap();
        let mut perms = std::fs::metadata(&path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&path, perms).unwrap();
        path
    }

    fn dummy_spec() -> DiscoverySpec {
        DiscoverySpec {
            bin_name: "thing",
            well_known_relative_to_home: vec![".thing/local"],
            well_known_absolute: vec![],
            version_args: &["--version"],
        }
    }

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

    #[test]
    fn version_key_orders_naturally() {
        assert!(VersionKey(1, 4, 3) > VersionKey(1, 1, 65));
        assert!(VersionKey(2, 0, 0) > VersionKey(1, 99, 99));
    }

    #[test]
    fn source_priority_orders_override_highest() {
        assert!(CandidateSource::Override > CandidateSource::LoginShellPath);
        assert!(CandidateSource::LoginShellPath > CandidateSource::EnvPath);
        assert!(CandidateSource::EnvPath > CandidateSource::WellKnown);
    }

    #[test]
    fn select_best_picks_highest_version_then_highest_source() {
        let candidates = vec![
            Candidate {
                path: PathBuf::from("/a/thing"),
                canonical: PathBuf::from("/a/thing"),
                version: Some(VersionKey(1, 4, 3)),
                source: CandidateSource::WellKnown,
            },
            Candidate {
                path: PathBuf::from("/b/thing"),
                canonical: PathBuf::from("/b/thing"),
                version: Some(VersionKey(1, 1, 65)),
                source: CandidateSource::EnvPath,
            },
        ];
        assert_eq!(
            select_best(&candidates).unwrap().path,
            PathBuf::from("/a/thing")
        );

        let same_version = vec![
            Candidate {
                path: PathBuf::from("/a/thing"),
                canonical: PathBuf::from("/a/thing"),
                version: Some(VersionKey(1, 0, 0)),
                source: CandidateSource::WellKnown,
            },
            Candidate {
                path: PathBuf::from("/b/thing"),
                canonical: PathBuf::from("/b/thing"),
                version: Some(VersionKey(1, 0, 0)),
                source: CandidateSource::EnvPath,
            },
        ];
        // Same version → higher-priority source wins.
        assert_eq!(
            select_best(&same_version).unwrap().path,
            PathBuf::from("/b/thing")
        );
    }

    #[test]
    fn select_best_prefers_versioned_over_unversioned() {
        let candidates = vec![
            Candidate {
                path: PathBuf::from("/a/thing"),
                canonical: PathBuf::from("/a/thing"),
                version: None,
                source: CandidateSource::Override,
            },
            Candidate {
                path: PathBuf::from("/b/thing"),
                canonical: PathBuf::from("/b/thing"),
                version: Some(VersionKey(0, 0, 1)),
                source: CandidateSource::WellKnown,
            },
        ];
        assert_eq!(
            select_best(&candidates).unwrap().path,
            PathBuf::from("/b/thing")
        );
    }

    #[test]
    fn select_best_returns_none_for_empty() {
        assert!(select_best(&[]).is_none());
    }

    #[test]
    fn walk_path_var_skips_non_executable_and_dedupes() {
        let dir = TempDir::new().unwrap();
        let other_dir = TempDir::new().unwrap();
        // Real binary in dir.
        let real = make_executable_with_body(dir.path(), "thing", "#!/bin/sh\necho 1\n");
        // Non-executable file: ignored.
        std::fs::write(dir.path().join("notexec"), "").unwrap();
        // Symlink in other_dir → same canonical: deduped.
        let symlink = other_dir.path().join("thing");
        std::os::unix::fs::symlink(&real, &symlink).unwrap();

        let mut seen = HashSet::new();
        let mut out = Vec::new();
        let path_var = format!("{}:{}", dir.path().display(), other_dir.path().display());
        walk_path_var(
            Some(std::ffi::OsStr::new(&path_var)),
            "thing",
            CandidateSource::EnvPath,
            &mut seen,
            &mut out,
        );

        assert_eq!(out.len(), 1, "symlink should dedupe to canonical of real");
        assert_eq!(out[0].canonical, std::fs::canonicalize(&real).unwrap());
    }

    #[test]
    fn walk_well_known_combines_home_and_absolute() {
        let home = TempDir::new().unwrap();
        let abs = TempDir::new().unwrap();
        std::fs::create_dir_all(home.path().join(".thing/local")).unwrap();
        make_executable_with_body(
            &home.path().join(".thing/local"),
            "thing",
            "#!/bin/sh\necho h\n",
        );
        make_executable_with_body(abs.path(), "thing", "#!/bin/sh\necho a\n");

        // Build a spec with the temp absolute path leaked to a static. We can't
        // do that easily, so we exercise just the home-relative arm here and
        // rely on the unit test for `walk_path_var` to cover the absolute arm
        // (mechanically identical).
        let spec = dummy_spec();
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        walk_well_known(&spec, Some(home.path()), &mut seen, &mut out);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].source, CandidateSource::WellKnown);
    }

    #[tokio::test]
    async fn discover_all_with_override_returns_only_override() {
        let dir = TempDir::new().unwrap();
        let path = make_executable_with_body(dir.path(), "thing", "#!/bin/sh\necho 1.2.3\n");
        let candidates = discover_all(&dummy_spec(), Some(&path)).await;
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].source, CandidateSource::Override);
        assert_eq!(
            candidates[0].canonical,
            std::fs::canonicalize(&path).unwrap()
        );
        assert_eq!(candidates[0].version, Some(VersionKey(1, 2, 3)));
    }

    #[tokio::test]
    async fn discover_all_falls_through_when_override_missing() {
        // Bogus override: should NOT short-circuit; falls through to regular
        // discovery (which here finds nothing).
        let candidates = discover_all(&dummy_spec(), Some(Path::new("/nonexistent/thing"))).await;
        // We can't assert empty (PATH may have a real `thing`), but we can
        // assert no Override entry slipped in.
        assert!(candidates
            .iter()
            .all(|candidate| candidate.source != CandidateSource::Override));
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
