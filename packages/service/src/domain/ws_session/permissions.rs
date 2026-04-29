/**
 * Permission resolution module for WebSocket session tool calls.
 *
 * Determines whether a tool call should be auto-allowed or needs user approval.
 * Auto-allows operations within the worktree or /tmp, prompts for everything else.
 * Handles persisting user approvals to `.claude/settings.local.json`.
 *
 * Originally ported from the TypeScript Electron implementation.
 */
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

use regex_lite::Regex;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Result of permission resolution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedPermission {
    /// Tool is auto-allowed (no user prompt needed).
    Allow,
    /// Tool is always denied.
    #[allow(dead_code)]
    Deny { reason: String },
    /// Tool needs user approval.
    NeedsPrompt {
        /// Human-readable description of what the tool is trying to do.
        description: String,
        /// Pattern for settings.local.json (e.g. "Read(/path/**)" or "Bash(git push:*)").
        pattern: String,
    },
}

// ---------------------------------------------------------------------------
// Tool → path field mapping
// ---------------------------------------------------------------------------

/// Tools that use `file_path` (or `notebook_path`) for their target path.
const FILE_PATH_TOOLS: &[&str] = &[
    "Read",
    "Write",
    "Edit",
    "MultiEdit",
    "NotebookRead",
    "NotebookEdit",
];

/// Tools that use `path` for their target path.
const PATH_TOOLS: &[&str] = &["Glob", "Grep"];

/// Tools that have no file-system side effects and are always safe.
const ALWAYS_ALLOW_TOOLS: &[&str] = &[
    "WebSearch",
    "WebFetch",
    "ExitPlanMode",
    "TodoRead",
    "TodoWrite",
];

/// Tools that must always be sent to the frontend as a permission request,
/// regardless of permission resolution. AskUserQuestion needs the frontend
/// to display a dynamic form and collect the user's answers.
pub const FRONTEND_PROMPT_TOOLS: &[&str] = &["AskUserQuestion"];

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/// Path-traversal defense: reject `..` components, canonicalize (falling
/// back to canonicalizing the parent for not-yet-existing write targets),
/// then check containment. `worktree_path` must already be canonical.
fn is_path_allowed(resolved_path: &Path, worktree_path: &Path) -> bool {
    if resolved_path
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return false;
    }

    if let Ok(canonical) = resolved_path.canonicalize() {
        return path_inside_allowed_roots(&canonical, worktree_path);
    }

    if let (Some(parent), Some(name)) = (resolved_path.parent(), resolved_path.file_name()) {
        if let Ok(canon_parent) = parent.canonicalize() {
            let candidate = canon_parent.join(name);
            return path_inside_allowed_roots(&candidate, worktree_path);
        }
    }

    // Nothing on disk to canonicalize against. `..` is already rejected
    // above, so a raw component-wise `starts_with` is safe.
    path_inside_allowed_roots(resolved_path, worktree_path)
}

fn path_inside_allowed_roots(path: &Path, worktree_path: &Path) -> bool {
    path.starts_with(worktree_path)
        || path.starts_with(tmp_canonical())
        || path == tmp_canonical()
        // The canonical `/tmp` differs from `/tmp` on macOS (it's a symlink
        // to `/private/tmp`). When `is_path_allowed` falls back to the raw
        // path (both canonicalize attempts failed), we need to accept the
        // pre-canonical form too.
        || path.starts_with("/tmp/")
        || path == Path::new("/tmp")
}

/// Canonical form of `/tmp` (on macOS it's a symlink to `/private/tmp`).
/// Resolved once at first use.
fn tmp_canonical() -> &'static Path {
    static TMP: OnceLock<PathBuf> = OnceLock::new();
    TMP.get_or_init(|| {
        Path::new("/tmp")
            .canonicalize()
            .unwrap_or_else(|_| PathBuf::from("/tmp"))
    })
}

/// Canonicalize a worktree path once for reuse across multiple permission checks.
pub fn canonicalize_worktree(worktree_path: &Path) -> PathBuf {
    worktree_path
        .canonicalize()
        .unwrap_or_else(|_| worktree_path.to_path_buf())
}

/// Check if a resolved path is an .env file (contains secrets).
fn is_env_file(resolved_path: &Path) -> bool {
    let basename = resolved_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    basename == ".env" || basename.starts_with(".env.") || basename.ends_with(".env")
}

/// Extract the primary path from a tool's input based on tool name.
/// Returns None if the tool doesn't operate on file paths.
fn extract_tool_path(tool_name: &str, input: &serde_json::Value) -> Option<String> {
    if FILE_PATH_TOOLS.contains(&tool_name) {
        let file_path = input
            .get("file_path")
            .or_else(|| input.get("notebook_path"));
        return file_path.and_then(|v| v.as_str()).map(|s| s.to_string());
    }

    if PATH_TOOLS.contains(&tool_name) {
        return input
            .get("path")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
    }

    None
}

// ---------------------------------------------------------------------------
// Bash command analysis
// ---------------------------------------------------------------------------

struct DestructiveCommandMatch {
    description: String,
    pattern: String,
}

/// Pre-compiled destructive command checks (regex, description, pattern).
fn destructive_checks() -> &'static [(Regex, &'static str, &'static str)] {
    static CHECKS: OnceLock<Vec<(Regex, &str, &str)>> = OnceLock::new();
    CHECKS.get_or_init(|| {
        vec![
            (
                Regex::new(r"\bgit\s+push\b").unwrap(),
                "git push will push commits to a remote repository",
                "Bash(git push:*)",
            ),
            (
                Regex::new(r"\brm\s+(?:-\w*[rR]\w*[fF]\w*|-\w*[fF]\w*[rR]\w*)\b").unwrap(),
                "rm -rf will recursively and forcefully delete files",
                "Bash(rm -rf:*)",
            ),
            (
                Regex::new(r"\bgit\s+reset\s+--hard\b").unwrap(),
                "git reset --hard will discard all uncommitted changes",
                "Bash(git reset --hard:*)",
            ),
            (
                Regex::new(r"\bgit\s+clean\s+-\w*[fF]").unwrap(),
                "git clean -f will remove untracked files from the repository",
                "Bash(git clean -f:*)",
            ),
            (
                Regex::new(r"\bgit\s+checkout\s+--\s").unwrap(),
                "git checkout -- will discard changes in working files",
                "Bash(git checkout --:*)",
            ),
            (
                Regex::new(r"\bsudo\s+rm\b").unwrap(),
                "sudo rm will delete files with root privileges",
                "Bash(sudo rm:*)",
            ),
        ]
    })
}

/// Detect destructive or sensitive bash commands that require user confirmation.
fn detect_destructive_command(command: &str) -> Option<DestructiveCommandMatch> {
    for (re, description, pattern) in destructive_checks() {
        if re.is_match(command) {
            return Some(DestructiveCommandMatch {
                description: description.to_string(),
                pattern: pattern.to_string(),
            });
        }
    }
    None
}

/// Check if a candidate string looks like a real filesystem path
/// rather than a sed/awk substitution pattern or regex.
fn looks_like_real_path(candidate: &str) -> bool {
    if candidate.len() < 2 {
        return false;
    }

    let parts: Vec<&str> = candidate.split('/').collect();
    let first_component = if parts.len() > 1 {
        parts[1]
    } else {
        return false;
    };

    if first_component.is_empty() {
        return false;
    }

    // If the first path component is too short, it's likely a regex token
    if first_component.len() <= 1 {
        return false;
    }

    // Reject patterns that end with common sed/awk flags: /g, /p, /d, /i, /I, /w, /e
    static SED_FLAGS: OnceLock<Regex> = OnceLock::new();
    let sed_flags = SED_FLAGS.get_or_init(|| Regex::new(r"/[gGpPdDiIwWe]$").unwrap());
    if sed_flags.is_match(candidate) {
        let components: Vec<&str> = candidate.split('/').filter(|s| !s.is_empty()).collect();
        if components.len() < 3 {
            return false;
        }
    }

    true
}

/// Extract paths from a bash command and return the first that lands
/// outside the worktree. Covers absolute paths, relative `..` traversal,
/// `./…` tokens, and `cd`/`pushd` with `..` arguments.
fn find_outside_path(command: &str, worktree_path: &Path) -> Option<String> {
    // `cd ..` / `pushd ..` alone is suspicious: a later command in the
    // same pipeline can then operate outside the worktree.
    if let Some(arg) = extract_cd_like_argument(command) {
        if contains_parent_dir_segment(arg) {
            return Some(arg.to_string());
        }
    }

    if let Some(found) = find_absolute_path_outside(command, worktree_path) {
        return Some(found);
    }
    if let Some(found) = find_relative_dotdot_outside(command, worktree_path) {
        return Some(found);
    }
    // `./foo` where `foo` is itself a symlink or holds `..` still needs a check.
    if let Some(found) = find_dot_slash_outside(command, worktree_path) {
        return Some(found);
    }

    None
}

fn find_absolute_path_outside(command: &str, worktree_path: &Path) -> Option<String> {
    static PATH_RE: OnceLock<Regex> = OnceLock::new();
    let path_regex =
        PATH_RE.get_or_init(|| Regex::new(r#"(?:^|\s|=|")(\/[^\s"'`;|&><()]+)"#).unwrap());

    for cap in path_regex.captures_iter(command) {
        let candidate = &cap[1];

        if is_skippable_abs_path(candidate) || !looks_like_real_path(candidate) {
            continue;
        }

        let candidate_path = Path::new(candidate);
        if !is_path_allowed(candidate_path, worktree_path) {
            return Some(candidate.to_string());
        }
    }

    None
}

fn find_relative_dotdot_outside(command: &str, worktree_path: &Path) -> Option<String> {
    static DOTDOT_RE: OnceLock<Regex> = OnceLock::new();
    let re = DOTDOT_RE.get_or_init(|| {
        Regex::new(r#"(?:^|\s|=|")([^\s"'`;|&><()]*\.\.[^\s"'`;|&><()]*)"#).unwrap()
    });

    for cap in re.captures_iter(command) {
        let candidate = &cap[1];
        // Only care about tokens where `..` is actually a path segment —
        // skip substrings like `HEAD..feature-branch` (git ref range) by
        // requiring a `/` on at least one side or standalone `..`.
        if !contains_parent_dir_segment(candidate) {
            continue;
        }
        let resolved = worktree_path.join(candidate);
        if !is_path_allowed(&resolved, worktree_path) {
            return Some(candidate.to_string());
        }
    }

    None
}

fn find_dot_slash_outside(command: &str, worktree_path: &Path) -> Option<String> {
    static DOT_SLASH_RE: OnceLock<Regex> = OnceLock::new();
    let re =
        DOT_SLASH_RE.get_or_init(|| Regex::new(r#"(?:^|\s|=|")(\./[^\s"'`;|&><()]+)"#).unwrap());

    for cap in re.captures_iter(command) {
        let candidate = &cap[1];
        let resolved = worktree_path.join(candidate);
        if !is_path_allowed(&resolved, worktree_path) {
            return Some(candidate.to_string());
        }
    }

    None
}

fn is_skippable_abs_path(candidate: &str) -> bool {
    candidate == "/dev/null" || candidate.starts_with("/dev/") || candidate.starts_with("/proc/")
}

/// True when the token contains `..` as a path component (not just as a
/// substring like `HEAD..feature`). That means either the token is exactly
/// `..`, or `..` is surrounded by `/` on at least one side.
fn contains_parent_dir_segment(token: &str) -> bool {
    if token == ".." {
        return true;
    }
    // Split on `/` and look for a `..` segment. `Path::components()` would
    // also work, but we want to evaluate the raw token before any path
    // normalisation so token forms like `../foo` or `x/../y` are caught.
    token.split('/').any(|seg| seg == "..")
}

/// Return the first argument of a `cd ` or `pushd ` invocation in the
/// command, if any. Matches the first token after the keyword.
fn extract_cd_like_argument(command: &str) -> Option<&str> {
    static CD_RE: OnceLock<Regex> = OnceLock::new();
    let re = CD_RE.get_or_init(|| Regex::new(r"\b(?:cd|pushd)\s+([^\s;&|><]+)").unwrap());
    re.captures(command)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str())
}

// ---------------------------------------------------------------------------
// Settings loading
// ---------------------------------------------------------------------------

/// Load pre-approved permission patterns from settings files.
/// Reads from three locations (union, no duplicates):
/// 1. ~/.claude/settings.json (global user settings)
/// 2. <worktreePath>/.claude/settings.json (project settings)
/// 3. <worktreePath>/.claude/settings.local.json (local settings)
pub fn load_allowed_patterns(worktree_path: &Path) -> HashSet<String> {
    load_allowed_patterns_with_home(
        worktree_path,
        &dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")),
    )
}

/// Load patterns with an explicit home directory (for testing).
fn load_allowed_patterns_with_home(worktree_path: &Path, home_dir: &Path) -> HashSet<String> {
    let mut patterns = HashSet::new();

    let settings_files = [
        home_dir.join(".claude").join("settings.json"),
        worktree_path.join(".claude").join("settings.json"),
        worktree_path.join(".claude").join("settings.local.json"),
    ];

    for file_path in &settings_files {
        if let Ok(content) = std::fs::read_to_string(file_path) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(allow) = parsed
                    .get("permissions")
                    .and_then(|p| p.get("allow"))
                    .and_then(|a| a.as_array())
                {
                    for pattern in allow {
                        if let Some(s) = pattern.as_str() {
                            patterns.insert(s.to_string());
                        }
                    }
                }
            }
        }
    }

    patterns
}

// ---------------------------------------------------------------------------
// Main resolution function
// ---------------------------------------------------------------------------

/// Resolve whether a tool call should be allowed or needs user permission.
pub fn resolve_permission(
    tool_name: &str,
    input: &serde_json::Value,
    worktree_path: &Path,
    session_cache: &HashSet<String>,
) -> ResolvedPermission {
    // Tools that must always prompt the frontend (e.g. AskUserQuestion needs
    // the UI to collect user answers via the permission.request flow).
    if FRONTEND_PROMPT_TOOLS.contains(&tool_name) {
        return ResolvedPermission::NeedsPrompt {
            description: format!("{tool_name} requires user interaction"),
            pattern: format!("{tool_name}(*)"),
        };
    }

    // Always-allowed tools (no file system impact)
    if ALWAYS_ALLOW_TOOLS.contains(&tool_name) {
        return ResolvedPermission::Allow;
    }

    // Auto-allow only our own (feature-pinned) MCP servers; third-party
    // servers go through the normal consent flow.
    if tool_name.starts_with("mcp__cadencr-") {
        return ResolvedPermission::Allow;
    }
    if tool_name.starts_with("mcp__") {
        return ResolvedPermission::NeedsPrompt {
            description: format!(
                "Third-party MCP tool `{tool_name}` wants to run. Cadencr can't \
                 audit its behavior — approve only if you trust the configured \
                 MCP server."
            ),
            pattern: format!("{tool_name}(*)"),
        };
    }

    // Handle Bash specially
    if tool_name == "Bash" {
        let command = input.get("command").and_then(|v| v.as_str()).unwrap_or("");

        // Check for destructive commands
        if let Some(destructive) = detect_destructive_command(command) {
            if session_cache.contains(&destructive.pattern) {
                return ResolvedPermission::Allow;
            }
            return ResolvedPermission::NeedsPrompt {
                description: destructive.description,
                pattern: destructive.pattern,
            };
        }

        // Check for absolute paths outside the worktree
        if let Some(outside_path) = find_outside_path(command, worktree_path) {
            let pattern = format!("Bash({outside_path}:*)");
            if session_cache.contains(&pattern) {
                return ResolvedPermission::Allow;
            }
            return ResolvedPermission::NeedsPrompt {
                description: format!(
                    "Bash command references path outside worktree: `{outside_path}`"
                ),
                pattern,
            };
        }

        // Bash command is within the worktree
        return ResolvedPermission::Allow;
    }

    // Path-based tools (Read, Write, Edit, Glob, Grep, etc.)
    if let Some(tool_path) = extract_tool_path(tool_name, input) {
        let resolved_path = if Path::new(&tool_path).is_absolute() {
            PathBuf::from(&tool_path)
        } else {
            worktree_path.join(&tool_path)
        };

        // Protect .env files — prompt even within the worktree (may contain secrets)
        if FILE_PATH_TOOLS.contains(&tool_name) && is_env_file(&resolved_path) {
            let pattern = format!("{}({})", tool_name, resolved_path.display());
            if session_cache.contains(&pattern) {
                return ResolvedPermission::Allow;
            }
            return ResolvedPermission::NeedsPrompt {
                description: format!(
                    "{tool_name} wants to read `{}`, which may contain secrets.",
                    resolved_path.display()
                ),
                pattern,
            };
        }

        if is_path_allowed(&resolved_path, worktree_path) {
            return ResolvedPermission::Allow;
        }

        let pattern = format!("{}({})", tool_name, resolved_path.display());
        if session_cache.contains(&pattern) {
            return ResolvedPermission::Allow;
        }

        return ResolvedPermission::NeedsPrompt {
            description: format!(
                "{tool_name} wants to access `{}`, which is outside the worktree.",
                resolved_path.display()
            ),
            pattern,
        };
    }

    // Unknown tool — auto-allow
    ResolvedPermission::Allow
}

// ---------------------------------------------------------------------------
// Settings local persistence
// ---------------------------------------------------------------------------

/// Append a permission pattern to `<worktreePath>/.claude/settings.local.json`.
///
/// Creates the file and directory if they don't exist.
/// Ensures no duplicate patterns.
pub fn append_to_settings_local(worktree_path: &Path, pattern: &str) -> Result<(), std::io::Error> {
    let claude_dir = worktree_path.join(".claude");
    let settings_path = claude_dir.join("settings.local.json");

    // Read existing settings or create empty structure
    let mut settings: serde_json::Value =
        if let Ok(content) = std::fs::read_to_string(&settings_path) {
            serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

    // Ensure permissions.allow array exists
    if !settings.get("permissions").is_some_and(|p| p.is_object()) {
        settings["permissions"] = serde_json::json!({});
    }
    if !settings["permissions"]
        .get("allow")
        .is_some_and(|a| a.is_array())
    {
        settings["permissions"]["allow"] = serde_json::json!([]);
    }

    // Add pattern if not already present
    let allow_list = settings["permissions"]["allow"].as_array_mut().unwrap();
    let pattern_value = serde_json::Value::String(pattern.to_string());
    if !allow_list.contains(&pattern_value) {
        allow_list.push(pattern_value);
    }

    // Ensure .claude directory exists
    std::fs::create_dir_all(&claude_dir)?;

    // Write back
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?
        + "\n";
    std::fs::write(&settings_path, content)?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_always_allow_tools() {
        let worktree = PathBuf::from("/project");
        let cache = HashSet::new();

        for tool in ALWAYS_ALLOW_TOOLS {
            assert_eq!(
                resolve_permission(tool, &serde_json::json!({}), &worktree, &cache),
                ResolvedPermission::Allow,
                "{tool} should be auto-allowed"
            );
        }
    }

    #[test]
    fn test_frontend_prompt_tools_not_auto_allowed() {
        let worktree = PathBuf::from("/project");
        let cache = HashSet::new();

        // AskUserQuestion must NOT be auto-allowed — it needs the frontend
        // round-trip to collect the user's answers via the permission.request flow.
        for tool in FRONTEND_PROMPT_TOOLS {
            assert_ne!(
                resolve_permission(tool, &serde_json::json!({}), &worktree, &cache),
                ResolvedPermission::Allow,
                "{tool} should NOT be auto-allowed (requires frontend prompt)"
            );
        }
    }

    #[test]
    fn test_ask_user_question_not_in_always_allow() {
        assert!(
            !ALWAYS_ALLOW_TOOLS.contains(&"AskUserQuestion"),
            "AskUserQuestion must not be in ALWAYS_ALLOW_TOOLS"
        );
        assert!(
            FRONTEND_PROMPT_TOOLS.contains(&"AskUserQuestion"),
            "AskUserQuestion must be in FRONTEND_PROMPT_TOOLS"
        );
    }

    #[test]
    fn cadencr_mcp_tools_auto_allow() {
        let worktree = PathBuf::from("/project");
        let cache = HashSet::new();

        for name in [
            "mcp__cadencr-plan__read_plan",
            "mcp__cadencr-execute__mark_phase_done",
            "mcp__cadencr-session__create_phase",
            "mcp__cadencr-review__read_phase",
        ] {
            assert_eq!(
                resolve_permission(name, &serde_json::json!({}), &worktree, &cache),
                ResolvedPermission::Allow,
                "{name} should auto-allow"
            );
        }
    }

    #[test]
    fn third_party_mcp_tools_need_prompt() {
        let worktree = PathBuf::from("/project");
        let cache = HashSet::new();

        let result = resolve_permission(
            "mcp__chrome__click",
            &serde_json::json!({}),
            &worktree,
            &cache,
        );
        assert!(
            matches!(result, ResolvedPermission::NeedsPrompt { .. }),
            "third-party mcp tool should prompt, got {result:?}"
        );

        let result = resolve_permission(
            "mcp__random_server__do_dangerous_thing",
            &serde_json::json!({}),
            &worktree,
            &cache,
        );
        assert!(matches!(result, ResolvedPermission::NeedsPrompt { .. }));
    }

    #[test]
    fn test_bash_safe_command() {
        let worktree = PathBuf::from("/project");
        let cache = HashSet::new();

        assert_eq!(
            resolve_permission(
                "Bash",
                &serde_json::json!({"command": "ls -la"}),
                &worktree,
                &cache
            ),
            ResolvedPermission::Allow
        );
    }

    #[test]
    fn test_bash_git_push_prompts() {
        let worktree = PathBuf::from("/project");
        let cache = HashSet::new();

        let result = resolve_permission(
            "Bash",
            &serde_json::json!({"command": "git push origin main"}),
            &worktree,
            &cache,
        );
        assert!(
            matches!(result, ResolvedPermission::NeedsPrompt { ref pattern, .. } if pattern == "Bash(git push:*)")
        );
    }

    #[test]
    fn test_bash_rm_rf_prompts() {
        let worktree = PathBuf::from("/project");
        let cache = HashSet::new();

        let result = resolve_permission(
            "Bash",
            &serde_json::json!({"command": "rm -rf /important"}),
            &worktree,
            &cache,
        );
        assert!(matches!(result, ResolvedPermission::NeedsPrompt { .. }));
    }

    #[test]
    fn test_bash_destructive_cached_allows() {
        let worktree = PathBuf::from("/project");
        let mut cache = HashSet::new();
        cache.insert("Bash(git push:*)".to_string());

        assert_eq!(
            resolve_permission(
                "Bash",
                &serde_json::json!({"command": "git push origin main"}),
                &worktree,
                &cache
            ),
            ResolvedPermission::Allow
        );
    }

    #[test]
    fn test_bash_outside_path_prompts() {
        let worktree = PathBuf::from("/project");
        let cache = HashSet::new();

        let result = resolve_permission(
            "Bash",
            &serde_json::json!({"command": "cat /etc/passwd"}),
            &worktree,
            &cache,
        );
        assert!(
            matches!(result, ResolvedPermission::NeedsPrompt { ref pattern, .. } if pattern == "Bash(/etc/passwd:*)")
        );
    }

    #[test]
    fn test_read_within_worktree_allows() {
        let worktree = PathBuf::from("/project");
        let cache = HashSet::new();

        assert_eq!(
            resolve_permission(
                "Read",
                &serde_json::json!({"file_path": "/project/src/main.rs"}),
                &worktree,
                &cache,
            ),
            ResolvedPermission::Allow
        );
    }

    #[test]
    fn test_read_outside_worktree_prompts() {
        let worktree = PathBuf::from("/project");
        let cache = HashSet::new();

        let result = resolve_permission(
            "Read",
            &serde_json::json!({"file_path": "/other/secret.txt"}),
            &worktree,
            &cache,
        );
        assert!(matches!(result, ResolvedPermission::NeedsPrompt { .. }));
    }

    #[test]
    fn test_read_tmp_allows() {
        let worktree = PathBuf::from("/project");
        let cache = HashSet::new();

        assert_eq!(
            resolve_permission(
                "Read",
                &serde_json::json!({"file_path": "/tmp/test.txt"}),
                &worktree,
                &cache,
            ),
            ResolvedPermission::Allow
        );
    }

    #[test]
    fn test_env_file_prompts() {
        let worktree = PathBuf::from("/project");
        let cache = HashSet::new();

        let result = resolve_permission(
            "Read",
            &serde_json::json!({"file_path": "/project/.env"}),
            &worktree,
            &cache,
        );
        assert!(
            matches!(result, ResolvedPermission::NeedsPrompt { ref description, .. } if description.contains("secrets"))
        );
    }

    #[test]
    fn test_env_file_variants() {
        assert!(is_env_file(Path::new("/project/.env")));
        assert!(is_env_file(Path::new("/project/.env.local")));
        assert!(is_env_file(Path::new("/project/prod.env")));
        assert!(!is_env_file(Path::new("/project/main.rs")));
    }

    #[test]
    fn test_unknown_tool_allows() {
        let worktree = PathBuf::from("/project");
        let cache = HashSet::new();

        assert_eq!(
            resolve_permission("SomeNewTool", &serde_json::json!({}), &worktree, &cache),
            ResolvedPermission::Allow
        );
    }

    #[test]
    fn test_looks_like_real_path() {
        assert!(looks_like_real_path("/Users/test/file.txt"));
        assert!(looks_like_real_path("/home/user/project"));
        assert!(!looks_like_real_path("/"));
        assert!(!looks_like_real_path("/g"));
        assert!(!looks_like_real_path("/a/b")); // first component is single char
    }

    #[test]
    fn test_sed_pattern_rejected() {
        // sed substitution pattern like s/foo/bar/g produces /foo/bar/g
        // This has 3 components so our heuristic allows it (matching TS behavior).
        // The TS version also allows /foo/bar/g since components.length >= 3.
        // Short single-segment patterns are rejected:
        assert!(!looks_like_real_path("/g"));
        assert!(!looks_like_real_path("/a/b"));
    }

    #[test]
    fn test_detect_destructive_commands() {
        assert!(detect_destructive_command("git push origin main").is_some());
        assert!(detect_destructive_command("rm -rf /").is_some());
        assert!(detect_destructive_command("rm -fR dir").is_some());
        assert!(detect_destructive_command("git reset --hard").is_some());
        assert!(detect_destructive_command("git clean -fd").is_some());
        assert!(detect_destructive_command("git checkout -- file.txt").is_some());
        assert!(detect_destructive_command("sudo rm /etc/important").is_some());
        assert!(detect_destructive_command("ls -la").is_none());
        assert!(detect_destructive_command("git status").is_none());
    }

    #[test]
    fn test_append_to_settings_local() {
        let tmp = tempfile::tempdir().unwrap();
        let worktree = tmp.path();

        append_to_settings_local(worktree, "Read(/some/path)").unwrap();

        let settings_path = worktree.join(".claude").join("settings.local.json");
        let content = std::fs::read_to_string(&settings_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        let allow = parsed["permissions"]["allow"].as_array().unwrap();
        assert_eq!(allow.len(), 1);
        assert_eq!(allow[0], "Read(/some/path)");

        // Adding same pattern again should not duplicate
        append_to_settings_local(worktree, "Read(/some/path)").unwrap();
        let content = std::fs::read_to_string(&settings_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        let allow = parsed["permissions"]["allow"].as_array().unwrap();
        assert_eq!(allow.len(), 1);

        // Adding different pattern should work
        append_to_settings_local(worktree, "Write(/other/path)").unwrap();
        let content = std::fs::read_to_string(&settings_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        let allow = parsed["permissions"]["allow"].as_array().unwrap();
        assert_eq!(allow.len(), 2);
    }

    #[test]
    fn test_load_allowed_patterns() {
        let tmp = tempfile::tempdir().unwrap();
        let worktree = tmp.path();
        let fake_home = tempfile::tempdir().unwrap();

        // Create settings.local.json with some patterns
        let claude_dir = worktree.join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();
        std::fs::write(
            claude_dir.join("settings.local.json"),
            r#"{"permissions": {"allow": ["Read(/foo)", "Bash(git push:*)"]}}"#,
        )
        .unwrap();

        let patterns = load_allowed_patterns_with_home(worktree, fake_home.path());
        assert!(patterns.contains("Read(/foo)"));
        assert!(patterns.contains("Bash(git push:*)"));
        assert_eq!(patterns.len(), 2);
    }

    #[test]
    fn test_session_cache_allows_previously_prompted() {
        let worktree = PathBuf::from("/project");
        let mut cache = HashSet::new();
        cache.insert("Read(/other/secret.txt)".to_string());

        assert_eq!(
            resolve_permission(
                "Read",
                &serde_json::json!({"file_path": "/other/secret.txt"}),
                &worktree,
                &cache,
            ),
            ResolvedPermission::Allow
        );
    }

    #[test]
    fn test_glob_outside_worktree_prompts() {
        let worktree = PathBuf::from("/project");
        let cache = HashSet::new();

        let result = resolve_permission(
            "Glob",
            &serde_json::json!({"path": "/etc"}),
            &worktree,
            &cache,
        );
        assert!(matches!(result, ResolvedPermission::NeedsPrompt { .. }));
    }

    #[test]
    fn test_relative_path_resolved_against_worktree() {
        let worktree = PathBuf::from("/project");
        let cache = HashSet::new();

        // Relative path should be resolved against worktree -> /project/src/main.rs
        assert_eq!(
            resolve_permission(
                "Read",
                &serde_json::json!({"file_path": "src/main.rs"}),
                &worktree,
                &cache,
            ),
            ResolvedPermission::Allow
        );
    }

    #[test]
    fn test_bash_dev_null_ignored() {
        let worktree = PathBuf::from("/project");
        let cache = HashSet::new();

        assert_eq!(
            resolve_permission(
                "Bash",
                &serde_json::json!({"command": "echo test > /dev/null"}),
                &worktree,
                &cache,
            ),
            ResolvedPermission::Allow
        );
    }

    #[test]
    fn is_path_allowed_rejects_dotdot() {
        let worktree = PathBuf::from("/project");
        assert!(!is_path_allowed(
            Path::new("/project/../etc/evil"),
            &worktree
        ));
        assert!(!is_path_allowed(
            Path::new("/project/subdir/../../outside"),
            &worktree
        ));
    }

    #[test]
    fn is_path_allowed_write_to_nonexistent_canonicalizes_parent() {
        let tmp = tempfile::TempDir::new().unwrap();
        let worktree = tmp.path().canonicalize().unwrap();
        let new_file = worktree.join("new-file.txt");
        assert!(!new_file.exists());
        assert!(is_path_allowed(&new_file, &worktree));
    }

    #[test]
    fn is_path_allowed_rejects_nonexistent_outside_worktree() {
        let tmp = tempfile::TempDir::new().unwrap();
        let worktree = tmp.path().canonicalize().unwrap();
        let other = tempfile::TempDir::new().unwrap();
        let new_file = other.path().canonicalize().unwrap().join("evil.txt");
        assert!(!is_path_allowed(&new_file, &worktree));
    }

    #[test]
    fn is_path_allowed_resolves_symlink_escapes() {
        let tmp = tempfile::TempDir::new().unwrap();
        let worktree = tmp.path().canonicalize().unwrap();
        let outside = tempfile::TempDir::new().unwrap();
        let outside_root = outside.path().canonicalize().unwrap();

        let link = worktree.join("escape");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside_root, &link).unwrap();

        #[cfg(unix)]
        assert!(!is_path_allowed(&link, &worktree));
    }

    #[test]
    fn find_outside_path_catches_relative_dotdot() {
        let tmp = tempfile::TempDir::new().unwrap();
        let worktree = tmp.path().canonicalize().unwrap();
        assert_eq!(
            find_outside_path("cat ../../../etc/passwd", &worktree),
            Some("../../../etc/passwd".to_string())
        );
    }

    #[test]
    fn find_outside_path_catches_dot_prefixed_dotdot() {
        let tmp = tempfile::TempDir::new().unwrap();
        let worktree = tmp.path().canonicalize().unwrap();
        assert_eq!(
            find_outside_path("rm ./../secrets", &worktree),
            Some("./../secrets".to_string())
        );
    }

    #[test]
    fn find_outside_path_catches_cd_parent() {
        let tmp = tempfile::TempDir::new().unwrap();
        let worktree = tmp.path().canonicalize().unwrap();
        assert_eq!(
            find_outside_path("cd .. && rm -rf .", &worktree),
            Some("..".to_string())
        );
    }

    #[test]
    fn find_outside_path_catches_pushd_parent() {
        let tmp = tempfile::TempDir::new().unwrap();
        let worktree = tmp.path().canonicalize().unwrap();
        let found = find_outside_path("pushd ../../etc", &worktree);
        assert!(found.is_some());
    }

    #[test]
    fn find_outside_path_ignores_git_ref_range() {
        // `HEAD..feature-branch` contains `..` as a substring, not as a
        // path segment. Must not be flagged.
        let tmp = tempfile::TempDir::new().unwrap();
        let worktree = tmp.path().canonicalize().unwrap();
        assert_eq!(
            find_outside_path("git log HEAD..feature-branch", &worktree),
            None
        );
    }

    #[test]
    fn find_outside_path_allows_relative_inside() {
        let tmp = tempfile::TempDir::new().unwrap();
        let worktree = tmp.path().canonicalize().unwrap();
        assert_eq!(
            find_outside_path("cat ./src/main.rs", &worktree),
            None,
            "relative paths inside the worktree must pass"
        );
    }

    #[test]
    fn contains_parent_dir_segment_recognises_paths() {
        assert!(contains_parent_dir_segment(".."));
        assert!(contains_parent_dir_segment("../etc"));
        assert!(contains_parent_dir_segment("foo/.."));
        assert!(contains_parent_dir_segment("foo/../bar"));
        assert!(!contains_parent_dir_segment("HEAD..feature"));
        assert!(!contains_parent_dir_segment("1.0..2.0"));
        assert!(!contains_parent_dir_segment("foo.bar"));
    }
}
