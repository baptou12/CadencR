//! Env-file detection and matching.
//!
//! Users keep environment files under many shapes — `.env`, `.env.local`,
//! `.env.production.local`, `local.env`, `development.env`, `api.env` — and
//! they're almost always gitignored. Cadencr nevertheless needs them to be
//! first-class citizens in the file tree, the Cmd+P picker, and the editor's
//! file search so humans can still find them when agents are doing the
//! typing. The matcher mirrors the frontend `isEnvFilePath` helper.

use std::path::Path;

/// Returns true when `file_name` looks like an env file.
///
/// Matches (case-insensitive):
/// - `.env` exactly,
/// - any file beginning with `.env.` (e.g. `.env.local`, `.env.production.local`),
/// - any file ending with `.env` (e.g. `local.env`, `development.env`, `api.env`).
pub fn is_env_file(file_name: &str) -> bool {
    let lower = file_name.to_lowercase();
    lower == ".env" || lower.starts_with(".env.") || lower.ends_with(".env")
}

/// Build an `ignore::overrides::Override` that narrows a `WalkBuilder` to
/// env files, while still letting the walker descend into normal
/// directories.
///
/// The whitelist patterns are `*.env`, `.env`, and `.env.*`. The `ignore`
/// crate treats a whitelist-only override as a strict allowlist for files:
/// a file that doesn't match any whitelist resolves to
/// `Match::Ignore(UnmatchedIgnore)` and the walker skips it. Directories,
/// however, resolve to `Match::None` and fall through to the walker's
/// normal gitignore handling, so the walk still descends into project
/// subdirectories — it just emits only env-file paths. Pair this with
/// `WalkBuilder::hidden(false)` so the `.env` dotfile isn't filtered out
/// before the override gets a chance to whitelist it.
pub fn env_file_overrides(project: &Path) -> ignore::overrides::Override {
    let mut builder = ignore::overrides::OverrideBuilder::new(project);
    builder.add("*.env").expect("static glob *.env compiles");
    builder.add(".env").expect("static glob .env compiles");
    builder.add(".env.*").expect("static glob .env.* compiles");
    builder.build().expect("static patterns build")
}

/// Walk `project` and return paths (relative to `project`) of every env
/// file, including the typically-gitignored ones (`.env`, `.env.local`).
///
/// Uses `ignore::WalkBuilder` with `git_ignore(true)` so we don't descend
/// into heavy gitignored directories like `node_modules`, plus
/// `hidden(false)` so dotfiles aren't filtered before the override gets a
/// chance to whitelist them. The override built by [`env_file_overrides`]
/// narrows the emitted files to env files only while still letting the
/// walker descend through ordinary project directories.
///
/// Errors from individual entries are silently skipped — a transient
/// `read_dir` failure on a single subtree shouldn't cause the whole
/// listing to fail.
pub fn find_env_files(project: &Path) -> Vec<String> {
    let mut walker = ignore::WalkBuilder::new(project);
    walker
        .hidden(false)
        .overrides(env_file_overrides(project))
        // `.git` is never useful; skip it for speed.
        .filter_entry(|entry| entry.file_name() != ".git");

    let mut out: Vec<String> = Vec::new();
    for result in walker.build() {
        let Ok(entry) = result else { continue };
        if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
            continue;
        }
        // The override's whitelist semantics filter non-env *files* but
        // pass directories through as `Match::None` so the walker keeps
        // descending. Re-check the basename here to make sure callers
        // only see env file paths.
        let name = entry.file_name().to_string_lossy();
        if !is_env_file(&name) {
            continue;
        }
        let Ok(rel) = entry.path().strip_prefix(project) else {
            continue;
        };
        out.push(rel.to_string_lossy().to_string());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_canonical_env_files() {
        assert!(is_env_file(".env"));
        assert!(is_env_file(".env.local"));
        assert!(is_env_file(".env.production.local"));
        assert!(is_env_file(".env.development"));
    }

    #[test]
    fn matches_suffix_env_files() {
        assert!(is_env_file("local.env"));
        assert!(is_env_file("development.env"));
        assert!(is_env_file("api.env"));
    }

    #[test]
    fn case_insensitive() {
        assert!(is_env_file(".ENV"));
        assert!(is_env_file(".Env.Local"));
        assert!(is_env_file("API.ENV"));
    }

    #[test]
    fn rejects_unrelated_files() {
        assert!(!is_env_file("env"));
        assert!(!is_env_file("notenv"));
        assert!(!is_env_file("env.txt"));
        assert!(!is_env_file("environment"));
        assert!(!is_env_file("envfile.json"));
        assert!(!is_env_file(""));
    }

    #[test]
    fn override_whitelists_env_file_paths() {
        let project = Path::new("/tmp/_cadencr_test_env_override");
        let ovr = env_file_overrides(project);

        // Whitelisted patterns return Whitelist regardless of nesting.
        assert!(ovr.matched(project.join(".env"), false).is_whitelist());
        assert!(ovr
            .matched(project.join(".env.local"), false)
            .is_whitelist());
        assert!(ovr
            .matched(project.join("apps/web/.env.production.local"), false)
            .is_whitelist());
        assert!(ovr.matched(project.join("local.env"), false).is_whitelist());
    }

    #[test]
    fn find_env_files_surfaces_gitignored_env_files() {
        use std::collections::HashSet;
        use std::fs;

        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        // The `ignore` crate only honors `.gitignore` when a `.git`
        // directory is present (`require_git(true)` is the default and
        // matches Cadencr's real-world projects).
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".gitignore"), ".env*\nnode_modules\n").unwrap();
        fs::write(root.join(".env"), "FOO=bar").unwrap();
        fs::write(root.join(".env.local"), "FOO=local").unwrap();
        fs::write(root.join("local.env"), "FOO=user").unwrap();
        fs::write(root.join("development.env"), "FOO=dev").unwrap();
        fs::write(root.join("README.md"), "# hi").unwrap();
        fs::write(root.join("notes.txt"), "notes").unwrap();

        // Nested dir with an env file.
        fs::create_dir_all(root.join("apps/web")).unwrap();
        fs::write(root.join("apps/web/.env.production.local"), "K=V").unwrap();
        fs::write(root.join("apps/web/index.ts"), "export {}").unwrap();

        // Heavy gitignored dir — should not be walked into (perf).
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join("node_modules/pkg/.env"), "nope").unwrap();

        let found: HashSet<String> = find_env_files(root).into_iter().collect();

        assert!(found.contains(".env"));
        assert!(found.contains(".env.local"));
        assert!(found.contains("local.env"));
        assert!(found.contains("development.env"));
        assert!(
            found.contains("apps/web/.env.production.local")
                || found.contains("apps\\web\\.env.production.local"),
            "expected nested env file, got {found:?}",
        );

        // Non-env files must not appear.
        assert!(!found.iter().any(|p| p == "README.md"));
        assert!(!found.iter().any(|p| p == "notes.txt"));
        assert!(!found.iter().any(|p| p.contains("index.ts")));

        // node_modules is gitignored, so the walker doesn't descend.
        assert!(
            !found.iter().any(|p| p.contains("node_modules")),
            "node_modules env file should not be surfaced, got {found:?}",
        );
    }

    #[test]
    fn override_filters_files_but_descends_into_directories() {
        // The override is positive-only, so non-env *files* are explicitly
        // ignored (walker drops them from output), but *directories* fall
        // through to Match::None so the walker still descends — modulo
        // the walker's gitignore handling, which keeps `node_modules`
        // etc. from being walked.
        let project = Path::new("/tmp/_cadencr_test_env_override");
        let ovr = env_file_overrides(project);

        assert!(ovr.matched(project.join("src/main.rs"), false).is_ignore());
        assert!(ovr.matched(project.join("README.md"), false).is_ignore());
        assert!(ovr.matched(project.join("src"), true).is_none());
        assert!(ovr.matched(project.join("apps/web"), true).is_none());
    }
}
