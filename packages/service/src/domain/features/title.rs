pub const MANUAL_TITLE_SETTING_KEY: &str = "title_manually_set";

#[derive(Clone, Copy)]
pub enum GeneratedTitlePolicy {
    PreserveManualTitle,
    ReplaceManualTitle,
}

/// Whether a title is one of the placeholders assigned before the first
/// prompt is named.
pub fn is_default_title(title: &str) -> bool {
    if title == "Untitled Feature" {
        return true;
    }
    let mut parts = title.split(' ');
    matches!(
        (parts.next(), parts.next(), parts.next()),
        (Some(prefix), Some(number), None)
            if prefix.eq_ignore_ascii_case("session")
                && !number.is_empty()
                && number.bytes().all(|byte| byte.is_ascii_digit())
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_only_placeholder_titles() {
        assert!(is_default_title("Session 1"));
        assert!(is_default_title("session 42"));
        assert!(is_default_title("Untitled Feature"));
        assert!(!is_default_title("Fix Login Bug"));
        assert!(!is_default_title("Session about logins"));
        assert!(!is_default_title("Session 1 extra"));
    }
}
