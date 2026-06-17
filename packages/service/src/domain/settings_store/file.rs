//! Low-level, path-based settings file I/O. Pure (no global state) so it is
//! fully unit-testable against temp dirs.

use std::collections::BTreeMap;
use std::path::Path;

use crate::error::AppError;

use super::SettingWarning;

/// Read raw file text. Returns `None` when the file does not exist.
pub fn read_file(path: &Path) -> Result<Option<String>, AppError> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Internal(format!(
            "failed to read settings file {}: {e}",
            path.display()
        ))),
    }
}

/// Parse a settings document into a flat `key -> string` map.
///
/// Scalar JSON values are coerced to strings (the storage contract is flat
/// strings, matching the legacy EAV tables): booleans/numbers stringify, `null`
/// is treated as unset, and arrays/objects are skipped with a warning. An empty
/// document is an empty map. Returns `Err` only when the top-level JSON is not a
/// valid object — callers decide whether that's fatal (editor save) or just a
/// surfaced warning (read-on-access).
pub fn parse_object(
    content: &str,
) -> Result<(BTreeMap<String, String>, Vec<SettingWarning>), String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Ok((BTreeMap::new(), Vec::new()));
    }

    let value: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| format!("not valid JSON: {e}"))?;
    let object = match value {
        serde_json::Value::Object(map) => map,
        _ => return Err("settings file must contain a JSON object".to_string()),
    };

    let mut out = BTreeMap::new();
    let mut warnings = Vec::new();
    for (key, val) in object {
        match val {
            serde_json::Value::String(s) => {
                out.insert(key, s);
            }
            serde_json::Value::Bool(b) => {
                out.insert(key, b.to_string());
            }
            serde_json::Value::Number(n) => {
                out.insert(key, n.to_string());
            }
            serde_json::Value::Null => {}
            serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
                warnings.push(SettingWarning::new(
                    key.clone(),
                    format!("\"{key}\" must be a string, boolean, or number — value ignored"),
                ));
            }
        }
    }
    Ok((out, warnings))
}

/// Serialize a settings map to pretty JSON with a trailing newline. Keys are
/// ordered (BTreeMap) so external diffs stay stable.
pub fn serialize_map(map: &BTreeMap<String, String>) -> String {
    let mut text = serde_json::to_string_pretty(map).unwrap_or_else(|_| "{}".to_string());
    text.push('\n');
    text
}

/// Atomically write `content` to `path`: write a sibling temp file, then rename
/// over the target. A reader therefore never observes a partially written file.
pub fn write_atomic(path: &Path, content: &str) -> Result<(), AppError> {
    let parent = path.parent().ok_or_else(|| {
        AppError::Internal(format!("settings path has no parent: {}", path.display()))
    })?;
    std::fs::create_dir_all(parent).map_err(|e| {
        AppError::Internal(format!(
            "failed to create settings dir {}: {e}",
            parent.display()
        ))
    })?;

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("settings.json");
    let tmp = parent.join(format!(".{file_name}.tmp"));
    std::fs::write(&tmp, content)
        .map_err(|e| AppError::Internal(format!("failed to write settings temp file: {e}")))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        AppError::Internal(format!(
            "failed to commit settings file {}: {e}",
            path.display()
        ))
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_reads_none() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nope.json");
        assert!(read_file(&path).unwrap().is_none());
    }

    #[test]
    fn write_then_read_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut map = BTreeMap::new();
        map.insert("theme_current".to_string(), "tokyo-night".to_string());
        write_atomic(&path, &serialize_map(&map)).unwrap();

        let text = read_file(&path).unwrap().unwrap();
        let (parsed, warnings) = parse_object(&text).unwrap();
        assert_eq!(
            parsed.get("theme_current").map(String::as_str),
            Some("tokyo-night")
        );
        assert!(warnings.is_empty());
    }

    #[test]
    fn coerces_scalars_to_strings() {
        let (map, warnings) =
            parse_object(r#"{"editor_auto_save": true, "editor_max_tabs": 5}"#).unwrap();
        assert_eq!(
            map.get("editor_auto_save").map(String::as_str),
            Some("true")
        );
        assert_eq!(map.get("editor_max_tabs").map(String::as_str), Some("5"));
        assert!(warnings.is_empty());
    }

    #[test]
    fn skips_null_and_warns_on_nested() {
        let (map, warnings) =
            parse_object(r#"{"a": null, "b": {"nested": 1}, "c": "ok"}"#).unwrap();
        assert!(!map.contains_key("a"));
        assert!(!map.contains_key("b"));
        assert_eq!(map.get("c").map(String::as_str), Some("ok"));
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].key, "b");
    }

    #[test]
    fn rejects_non_object_json() {
        assert!(parse_object("[1, 2, 3]").is_err());
        assert!(parse_object("\"hi\"").is_err());
        assert!(parse_object("{ broken").is_err());
    }

    #[test]
    fn empty_document_is_empty_map() {
        let (map, warnings) = parse_object("   ").unwrap();
        assert!(map.is_empty());
        assert!(warnings.is_empty());
    }
}
