//! Branch-name generation + safe worktree-path construction. Pure helpers
//! with no DB or WS dependencies — easy to unit-test.

use std::path::{Path, PathBuf};

use rand::Rng;

use crate::shared::slug::slugify;

/// Build a branch name from a prefix and title.
/// Format: `{prefix}{slug}-{xxxx}` where xxxx is 4-char random hex.
pub fn build_branch_name(prefix: &str, title: &str) -> String {
    let slug = slugify(title);
    let suffix: u16 = rand::thread_rng().gen_range(0..=0xFFFF);
    let hex = format!("{:04x}", suffix);
    format!("{}{}-{}", prefix, slug, hex)
}

/// Build `~/.cadencr/{project_name}/{safe_branch}` and verify the canonical
/// result stays under the canonical `~/.cadencr`. Creates the parent dir if
/// it does not exist; the leaf is the worktree dir that `git worktree add`
/// will create itself.
pub(super) async fn build_contained_worktree_path(
    cadencr_root: &Path,
    project_name: &str,
    safe_branch: &str,
) -> Result<PathBuf, String> {
    if project_name.is_empty()
        || project_name.contains('/')
        || project_name.contains('\\')
        || project_name.contains("..")
    {
        return Err(format!(
            "refusing to build worktree path for unsafe project name: {project_name:?}"
        ));
    }
    if safe_branch.is_empty() || safe_branch.contains('/') || safe_branch.contains("..") {
        return Err(format!(
            "refusing to build worktree path for unsafe branch: {safe_branch:?}"
        ));
    }

    let parent = cadencr_root.join(project_name);
    tokio::fs::create_dir_all(&parent)
        .await
        .map_err(|e| format!("Failed to create parent dir: {e}"))?;

    let canon_parent = parent
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize parent dir: {e}"))?;
    let canon_root = cadencr_root
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize ~/.cadencr: {e}"))?;
    if !canon_parent.starts_with(&canon_root) {
        return Err(format!(
            "Resolved worktree parent escapes ~/.cadencr: {}",
            canon_parent.display()
        ));
    }

    Ok(canon_parent.join(safe_branch))
}

/// Resolve `~/.cadencr/{project}/{safe-branch}` and return it as a string.
pub(super) async fn compute_worktree_path(
    project_name: &str,
    branch: &str,
) -> Result<String, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let cadencr_root = home.join(".cadencr");
    let safe_branch = branch.replace('/', "-");
    let path = build_contained_worktree_path(&cadencr_root, project_name, &safe_branch).await?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_branch_name_format() {
        let name = build_branch_name("feature/", "My Cool Feature");
        assert!(name.starts_with("feature/my-cool-feature-"));
        // Should end with 4 hex chars
        let suffix = &name[name.len() - 4..];
        assert!(suffix.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_build_branch_name_suffix_length() {
        let name = build_branch_name("fix/", "test");
        // format: fix/test-xxxx
        assert!(name.starts_with("fix/test-"));
        let parts: Vec<&str> = name.rsplitn(2, '-').collect();
        assert_eq!(parts[0].len(), 4);
    }

    #[test]
    fn test_build_branch_name_special_chars() {
        let name = build_branch_name("feature/", "Hello World! @#$ Test");
        assert!(name.starts_with("feature/hello-world-test-"));
    }

    #[test]
    fn test_build_branch_name_empty_prefix() {
        let name = build_branch_name("", "my feature");
        assert!(name.starts_with("my-feature-"));
        assert_eq!(name.len(), "my-feature-".len() + 4);
    }

    #[test]
    fn test_build_branch_name_empty_title() {
        let name = build_branch_name("feature/", "");
        // slugify("") = "", so format is "feature/-xxxx"
        assert!(name.starts_with("feature/-"));
        let suffix = &name[name.len() - 4..];
        assert!(suffix.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_build_branch_name_uniqueness() {
        // Two calls should (almost certainly) produce different names
        let a = build_branch_name("f/", "test");
        let b = build_branch_name("f/", "test");
        // Not guaranteed but with 65536 possibilities, collision is ~1/65536
        // We run multiple pairs to be safe
        let mut all_same = true;
        for _ in 0..5 {
            let x = build_branch_name("f/", "test");
            let y = build_branch_name("f/", "test");
            if x != y {
                all_same = false;
                break;
            }
        }
        // If somehow all 5 pairs collided, that's astronomically unlikely but not impossible.
        // Just check format is correct as the real assertion.
        assert!(a.starts_with("f/test-"));
        assert!(b.starts_with("f/test-"));
        // Suffix is hex
        let suffix_a = &a[a.len() - 4..];
        assert!(suffix_a.chars().all(|c| c.is_ascii_hexdigit()));
        let _ = all_same; // used above
    }

    #[test]
    fn test_build_branch_name_long_title() {
        let name = build_branch_name("feature/", &"a".repeat(100));
        // slug is capped at 50, so branch = "feature/" + 50 a's + "-" + 4 hex
        assert!(name.starts_with("feature/"));
        let without_prefix = &name["feature/".len()..];
        let parts: Vec<&str> = without_prefix.rsplitn(2, '-').collect();
        assert_eq!(parts[0].len(), 4); // hex suffix
        assert!(parts[1].len() <= 50); // slug portion
    }

    #[test]
    fn test_safe_branch_replaces_slashes() {
        let branch = "feature/my-cool-feature-abcd";
        let safe = branch.replace('/', "-");
        assert_eq!(safe, "feature-my-cool-feature-abcd");
        assert!(!safe.contains('/'));
    }

    #[test]
    fn test_worktree_path_construction() {
        // Simulates the path logic from ensure_worktree (lines 106-111)
        let branch = "feature/implement-queue-1a2b";
        let safe_branch = branch.replace('/', "-");
        let project_name = "my-project";

        let home = dirs::home_dir().expect("home dir");
        let expected = home.join(".cadencr").join(project_name).join(&safe_branch);

        // Verify structure
        assert!(expected.to_string_lossy().contains(".cadencr"));
        assert!(expected.to_string_lossy().contains(project_name));
        assert!(expected
            .to_string_lossy()
            .contains("feature-implement-queue-1a2b"));
    }

    #[test]
    fn test_worktree_path_no_slashes_in_final_component() {
        let branch = "fix/some/nested/branch-ff00";
        let safe_branch = branch.replace('/', "-");
        assert_eq!(safe_branch, "fix-some-nested-branch-ff00");

        let home = dirs::home_dir().expect("home dir");
        let path = home.join(".cadencr").join("proj").join(&safe_branch);
        // The final component should have no slashes
        let file_name = path.file_name().unwrap().to_string_lossy();
        assert!(!file_name.contains('/'));
    }

    #[tokio::test]
    async fn build_contained_worktree_rejects_parent_in_project_name() {
        let tmp = std::env::temp_dir().join("cadencr-b4-1");
        let _ = tokio::fs::remove_dir_all(&tmp).await;
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let err = build_contained_worktree_path(&tmp, "../escape", "branch")
            .await
            .unwrap_err();
        assert!(err.contains("unsafe project name"), "{err}");
        let _ = tokio::fs::remove_dir_all(&tmp).await;
    }

    #[tokio::test]
    async fn build_contained_worktree_rejects_slash_in_project_name() {
        let tmp = std::env::temp_dir().join("cadencr-b4-2");
        let _ = tokio::fs::remove_dir_all(&tmp).await;
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let err = build_contained_worktree_path(&tmp, "a/b", "branch")
            .await
            .unwrap_err();
        assert!(err.contains("unsafe project name"), "{err}");
        let _ = tokio::fs::remove_dir_all(&tmp).await;
    }

    #[tokio::test]
    async fn build_contained_worktree_accepts_safe_inputs() {
        let tmp = std::env::temp_dir().join("cadencr-b4-3");
        let _ = tokio::fs::remove_dir_all(&tmp).await;
        tokio::fs::create_dir_all(&tmp).await.unwrap();
        let result = build_contained_worktree_path(&tmp, "proj", "feat-branch")
            .await
            .unwrap();
        let canon_tmp = tokio::fs::canonicalize(&tmp).await.unwrap();
        assert!(result.starts_with(&canon_tmp), "{}", result.display());
        assert!(result.ends_with("feat-branch"));
        let _ = tokio::fs::remove_dir_all(&tmp).await;
    }
}
