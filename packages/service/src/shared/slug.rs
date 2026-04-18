/// Slugify a title: lowercase, replace non-alphanumeric with `-`, collapse consecutive `-`,
/// trim leading/trailing `-`, cap at 50 chars.
pub fn slugify(title: &str) -> String {
    let slug: String = title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let mut result = String::new();
    let mut prev_dash = false;
    for c in slug.chars() {
        if c == '-' {
            if !prev_dash {
                result.push('-');
            }
            prev_dash = true;
        } else {
            result.push(c);
            prev_dash = false;
        }
    }
    let trimmed = result.trim_matches('-');
    if trimmed.len() > 50 {
        trimmed[..50].trim_end_matches('-').to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_basic() {
        assert_eq!(slugify("My Cool Feature"), "my-cool-feature");
    }

    #[test]
    fn slugify_special_chars() {
        assert_eq!(slugify("hello@world! #test"), "hello-world-test");
    }

    #[test]
    fn slugify_consecutive_dashes() {
        assert_eq!(slugify("a---b---c"), "a-b-c");
    }

    #[test]
    fn slugify_leading_trailing() {
        assert_eq!(slugify("--hello--"), "hello");
    }

    #[test]
    fn slugify_length_cap() {
        let long = "a".repeat(100);
        let result = slugify(&long);
        assert!(result.len() <= 50);
    }

    #[test]
    fn slugify_empty() {
        assert_eq!(slugify(""), "");
    }

    #[test]
    fn slugify_all_special_chars() {
        assert_eq!(slugify("!@#$%^&*()"), "");
    }

    #[test]
    fn slugify_single_char() {
        assert_eq!(slugify("a"), "a");
    }

    #[test]
    fn slugify_numbers() {
        assert_eq!(slugify("version 2.0 release"), "version-2-0-release");
    }

    #[test]
    fn slugify_mixed_case() {
        assert_eq!(slugify("CamelCase AND UPPER"), "camelcase-and-upper");
    }

    #[test]
    fn slugify_unicode_replaced() {
        assert_eq!(slugify("café"), "caf");
    }

    #[test]
    fn slugify_length_cap_trims_trailing_dash() {
        let input = format!("{} {}", "a".repeat(49), "b");
        let result = slugify(&input);
        assert!(result.len() <= 50);
        assert!(!result.ends_with('-'));
    }

    #[test]
    fn slugify_exactly_50_chars() {
        let input = "a".repeat(50);
        assert_eq!(slugify(&input), "a".repeat(50));
    }

    #[test]
    fn slugify_51_chars_truncated() {
        let input = "a".repeat(51);
        assert_eq!(slugify(&input), "a".repeat(50));
    }

    #[test]
    fn slugify_spaces_only() {
        assert_eq!(slugify("   "), "");
    }

    #[test]
    fn slugify_tabs_and_newlines() {
        assert_eq!(slugify("hello\tworld\nfoo"), "hello-world-foo");
    }

    #[test]
    fn slugify_strips_parent_dir() {
        assert_eq!(slugify("../evil"), "evil");
        assert_eq!(slugify("foo/../bar"), "foo-bar");
    }
}
