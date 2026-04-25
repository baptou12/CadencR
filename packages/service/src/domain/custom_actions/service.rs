use std::collections::{BTreeSet, HashMap};
use std::sync::LazyLock;

use regex_lite::Regex;

use super::models::Scope;
use crate::error::AppError;

/// `${VAR_NAME}` placeholders. Compiled once via `LazyLock` so call sites
/// don't pay regex compilation per invocation.
static VAR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}").expect("static regex compiles"));

/// Returns the unique `${VAR}` names referenced by `command`, in declaration
/// order. Names match `[A-Za-z_][A-Za-z0-9_]*`. Malformed brackets like
/// `${1bad}` or `${}` simply don't match and stay literal.
pub fn extract_variables(command: &str) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for caps in VAR_RE.captures_iter(command) {
        let name = caps.get(1).expect("capture group 1").as_str().to_string();
        if seen.insert(name.clone()) {
            out.push(name);
        }
    }
    out
}

/// Substitutes every `${VAR}` in `command` with the matching entry in `values`.
/// Returns `BadRequest` listing every missing variable name when one or more
/// values are absent.
pub fn interpolate(command: &str, values: &HashMap<String, String>) -> Result<String, AppError> {
    let mut missing: BTreeSet<String> = BTreeSet::new();
    let result = VAR_RE.replace_all(command, |caps: &regex_lite::Captures| {
        let name = caps.get(1).expect("capture group 1").as_str();
        match values.get(name) {
            Some(v) => v.clone(),
            None => {
                missing.insert(name.to_string());
                String::new()
            }
        }
    });
    if !missing.is_empty() {
        return Err(AppError::BadRequest(format!(
            "Missing values for variables: {}",
            missing.into_iter().collect::<Vec<_>>().join(", ")
        )));
    }
    Ok(result.into_owned())
}

/// Enforce the same invariant as the SQL CHECK constraint, so the route
/// returns a friendlier 400 instead of letting SQLite reject the insert.
pub fn validate_scope(scope: Scope, project_id: Option<i64>) -> Result<(), AppError> {
    match (scope, project_id) {
        (Scope::Global, None) | (Scope::Project, Some(_)) => Ok(()),
        (Scope::Global, Some(_)) => Err(AppError::BadRequest(
            "Global custom actions must not have a project_id".into(),
        )),
        (Scope::Project, None) => Err(AppError::BadRequest(
            "Project-scoped custom actions require a project_id".into(),
        )),
    }
}

/// Reject icon payloads larger than 512 KB to keep the DB and JSON responses
/// small.
pub const MAX_ICON_BYTES: usize = 512 * 1024;

pub fn validate_icon(icon: Option<&str>) -> Result<(), AppError> {
    if let Some(data) = icon {
        if data.len() > MAX_ICON_BYTES {
            return Err(AppError::BadRequest(format!(
                "Icon is too large ({} bytes); maximum is {} bytes. Compress or resize before uploading.",
                data.len(),
                MAX_ICON_BYTES
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_variables_empty_returns_nothing() {
        assert!(extract_variables("").is_empty());
        assert!(extract_variables("git status").is_empty());
    }

    #[test]
    fn extract_variables_returns_single_var() {
        assert_eq!(extract_variables("gh pr view ${PR_ID}"), vec!["PR_ID"]);
    }

    #[test]
    fn extract_variables_dedupes_and_preserves_order() {
        assert_eq!(
            extract_variables("echo ${A} && echo ${B} && echo ${A}"),
            vec!["A", "B"]
        );
    }

    #[test]
    fn extract_variables_ignores_malformed() {
        assert!(extract_variables("${1bad}").is_empty());
        assert!(extract_variables("${}").is_empty());
        assert!(extract_variables("$NOT_A_VAR").is_empty());
    }

    #[test]
    fn interpolate_substitutes_all_vars() {
        let mut v = HashMap::new();
        v.insert("PR_ID".into(), "42".into());
        let out = interpolate("gh pr view ${PR_ID}", &v).unwrap();
        assert_eq!(out, "gh pr view 42");
    }

    #[test]
    fn interpolate_errors_on_missing_var_and_lists_them() {
        let v = HashMap::new();
        let err = interpolate("echo ${A} ${B}", &v).unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("A"));
        assert!(msg.contains("B"));
    }

    #[test]
    fn interpolate_handles_repeated_var() {
        let mut v = HashMap::new();
        v.insert("X".into(), "ok".into());
        let out = interpolate("${X}-${X}", &v).unwrap();
        assert_eq!(out, "ok-ok");
    }

    #[test]
    fn validate_scope_accepts_valid_combinations() {
        assert!(validate_scope(Scope::Global, None).is_ok());
        assert!(validate_scope(Scope::Project, Some(1)).is_ok());
    }

    #[test]
    fn validate_scope_rejects_invalid_combinations() {
        assert!(validate_scope(Scope::Global, Some(1)).is_err());
        assert!(validate_scope(Scope::Project, None).is_err());
    }

    #[test]
    fn validate_icon_rejects_oversize() {
        let huge = "x".repeat(MAX_ICON_BYTES + 1);
        assert!(validate_icon(Some(&huge)).is_err());
        assert!(validate_icon(Some("data:image/png;base64,abc")).is_ok());
        assert!(validate_icon(None).is_ok());
    }
}
