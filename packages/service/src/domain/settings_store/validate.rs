//! Defensive validation applied when settings are read for consumption.
//!
//! Rules (per key):
//! - Known key with a constrained spec, value valid → keep verbatim.
//! - Known key with a constrained spec, value invalid → warn and substitute the
//!   in-code default (or drop the key when the spec has no default, so the
//!   consumer's own fallback applies).
//! - Known key without a spec (free-form) → keep verbatim.
//! - Unknown key → warn but keep verbatim (the file belongs to the user; we
//!   never silently discard their data).

use std::collections::BTreeMap;

use super::{Scope, SettingWarning};

/// Validate a parsed settings map for `scope`, returning the cleaned map (with
/// invalid values replaced by defaults) plus any warnings.
pub fn validate(
    scope: Scope,
    map: BTreeMap<String, String>,
) -> (BTreeMap<String, String>, Vec<SettingWarning>) {
    let mut clean = BTreeMap::new();
    let mut warnings = Vec::new();

    for (key, value) in map {
        if let Some(spec) = scope.spec(&key) {
            if spec.is_valid(&value) {
                clean.insert(key, value);
            } else {
                match spec.default {
                    Some(default) => {
                        warnings.push(SettingWarning::new(
                            &key,
                            format!(
                                "\"{key}\" has invalid value \"{value}\" — using default \"{default}\""
                            ),
                        ));
                        clean.insert(key, default.to_string());
                    }
                    None => {
                        warnings.push(SettingWarning::new(
                            &key,
                            format!("\"{key}\" has invalid value \"{value}\" — ignored"),
                        ));
                    }
                }
            }
        } else if scope.is_key_known(&key) {
            clean.insert(key, value);
        } else {
            warnings.push(SettingWarning::new(
                &key,
                format!("\"{key}\" is not a recognized setting — it will be ignored by the app"),
            ));
            clean.insert(key, value);
        }
    }

    (clean, warnings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn valid_known_value_passes() {
        let (clean, warnings) = validate(Scope::Workspace, map(&[("editor_auto_save", "false")]));
        assert_eq!(
            clean.get("editor_auto_save").map(String::as_str),
            Some("false")
        );
        assert!(warnings.is_empty());
    }

    #[test]
    fn invalid_value_falls_back_to_default_with_warning() {
        let (clean, warnings) = validate(Scope::Workspace, map(&[("editor_auto_save", "maybe")]));
        assert_eq!(
            clean.get("editor_auto_save").map(String::as_str),
            Some("true")
        );
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].key, "editor_auto_save");
    }

    #[test]
    fn invalid_value_without_default_is_dropped() {
        let (clean, warnings) = validate(
            Scope::Workspace,
            map(&[("agent_stream_verbosity_mode", "loud")]),
        );
        assert!(!clean.contains_key("agent_stream_verbosity_mode"));
        assert_eq!(warnings.len(), 1);
    }

    #[test]
    fn unknown_key_warns_but_is_kept() {
        let (clean, warnings) = validate(Scope::Workspace, map(&[("totally_made_up", "x")]));
        assert_eq!(clean.get("totally_made_up").map(String::as_str), Some("x"));
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].message.contains("not a recognized setting"));
    }

    #[test]
    fn free_form_known_key_is_kept_verbatim() {
        let (clean, warnings) =
            validate(Scope::Workspace, map(&[("theme_current", "tokyo-night")]));
        assert_eq!(
            clean.get("theme_current").map(String::as_str),
            Some("tokyo-night")
        );
        assert!(warnings.is_empty());
    }

    #[test]
    fn dynamic_prefix_key_is_recognized() {
        // `thinking_effort_model_<id>` is allowed via the allowlist's dynamic
        // prefixes, so it must not be flagged as unknown.
        let (_, warnings) = validate(
            Scope::Workspace,
            map(&[("thinking_effort_model_claude_code_default", "high")]),
        );
        assert!(warnings.is_empty());
    }
}
