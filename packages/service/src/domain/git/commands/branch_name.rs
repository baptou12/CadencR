//! Build branch names from a prefix + feature title. Mirrors the TypeScript
//! implementation: slug + random 4-char hex.

/// Build a branch name from a prefix and feature title.
/// Matches the TypeScript implementation: slug + random 4-char hex.
pub fn build_branch_name(prefix: &str, title: &str) -> String {
    let slug: String = title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();

    // Collapse multiple dashes and trim leading/trailing
    let mut result = String::new();
    let mut last_was_dash = true; // treat start as dash to trim leading
    for c in slug.chars() {
        if c == '-' {
            if !last_was_dash {
                result.push('-');
            }
            last_was_dash = true;
        } else {
            result.push(c);
            last_was_dash = false;
        }
    }
    // Trim trailing dash
    let slug = result.trim_end_matches('-');
    // Truncate to 50 chars
    let slug = &slug[..slug.len().min(50)];

    // Random 4-char hex suffix
    let suffix: String = format!("{:04x}", rand::random::<u16>());

    format!("{prefix}{slug}-{suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_branch_name_basic() {
        let name = build_branch_name("feature/", "My Feature");
        assert!(
            name.starts_with("feature/"),
            "should start with prefix, got: {name}"
        );
        assert!(
            name.contains("my-feature"),
            "should contain slug, got: {name}"
        );
        // 4-char hex suffix after last dash
        let suffix = &name[name.rfind('-').unwrap() + 1..];
        assert_eq!(
            suffix.len(),
            4,
            "suffix should be 4 hex chars, got: {suffix}"
        );
        assert!(suffix.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_build_branch_name_special_chars() {
        let name = build_branch_name("feature/", "Hello, World! @#$%");
        assert!(name.starts_with("feature/"));
        // Special chars should become hyphens (collapsed)
        assert!(!name.contains(','));
        assert!(!name.contains('!'));
        assert!(!name.contains('@'));
    }

    #[test]
    fn test_build_branch_name_long_title() {
        let long_title = "a".repeat(100);
        let name = build_branch_name("feature/", &long_title);
        // prefix (8) + slug (<=50) + dash (1) + suffix (4) = max 63
        assert!(name.len() <= 63, "name too long: {} chars", name.len());
    }
}
