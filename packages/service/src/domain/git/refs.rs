/// Normalize common Git ref labels into a local branch identity.
pub fn normalize_branch_identity(branch: &str) -> &str {
    let trimmed = branch.trim();
    trimmed
        .strip_prefix("refs/heads/")
        .or_else(|| trimmed.strip_prefix("refs/remotes/origin/"))
        .or_else(|| trimmed.strip_prefix("origin/"))
        .unwrap_or(trimmed)
}

#[cfg(test)]
mod tests {
    use super::normalize_branch_identity;

    #[test]
    fn normalizes_local_and_origin_refs() {
        assert_eq!(normalize_branch_identity("refs/heads/main"), "main");
        assert_eq!(
            normalize_branch_identity("refs/remotes/origin/main"),
            "main"
        );
        assert_eq!(normalize_branch_identity("origin/main"), "main");
        assert_eq!(normalize_branch_identity(" feature/a "), "feature/a");
    }
}
