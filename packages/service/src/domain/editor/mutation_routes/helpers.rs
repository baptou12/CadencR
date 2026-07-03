use crate::error::AppError;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Reject names that contain path separators or traversal segments. The new
/// name is always a single path component — the caller chooses the parent.
pub(super) fn validate_simple_name(name: &str) -> Result<(), AppError> {
    if name.is_empty() {
        return Err(AppError::BadRequest("Name cannot be empty".to_string()));
    }
    if name.contains('/') || name.contains('\\') || name == "." || name == ".." {
        return Err(AppError::BadRequest(
            "Name must be a single path component".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    pub(super) fn validate_simple_name_rejects_separators_and_traversal() {
        assert!(validate_simple_name("foo.txt").is_ok());
        assert!(validate_simple_name("").is_err());
        assert!(validate_simple_name("a/b").is_err());
        assert!(validate_simple_name("a\\b").is_err());
        assert!(validate_simple_name("..").is_err());
        assert!(validate_simple_name(".").is_err());
    }
}
