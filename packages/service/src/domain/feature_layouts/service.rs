use crate::error::AppError;

/// Reject obviously bad payloads at the boundary so we don't store garbage that
/// the frontend would have to defensively re-validate on every read. The full
/// shape (split tree, tab kinds) is the frontend's responsibility — we only
/// check that `config` is JSON-shaped.
pub fn validate_name(name: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("name is required".into()));
    }
    if trimmed.len() > 100 {
        return Err(AppError::BadRequest(
            "name is too long (max 100 chars)".into(),
        ));
    }
    Ok(())
}

pub fn validate_config(config: &str) -> Result<(), AppError> {
    if config.trim().is_empty() {
        return Err(AppError::BadRequest("config is required".into()));
    }
    if serde_json::from_str::<serde_json::Value>(config).is_err() {
        return Err(AppError::BadRequest("config must be valid JSON".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_name_accepts_normal_input() {
        assert!(validate_name("Default").is_ok());
        assert!(validate_name("  spaced  ").is_ok());
    }

    #[test]
    fn validate_name_rejects_empty_or_whitespace() {
        assert!(validate_name("").is_err());
        assert!(validate_name("   ").is_err());
    }

    #[test]
    fn validate_name_rejects_overly_long() {
        let long = "x".repeat(101);
        assert!(validate_name(&long).is_err());
    }

    #[test]
    fn validate_config_accepts_valid_json() {
        assert!(validate_config("{}").is_ok());
        assert!(validate_config(r#"{"version":1,"splitRoot":null}"#).is_ok());
    }

    #[test]
    fn validate_config_rejects_empty_or_garbage() {
        assert!(validate_config("").is_err());
        assert!(validate_config("not json").is_err());
        assert!(validate_config("{").is_err());
    }
}
