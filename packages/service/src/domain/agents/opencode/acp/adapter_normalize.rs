//! Edit-tool input normalization for OpenCode's ACP adapter.
//!
//! OpenCode (and ACP in general) names file-edit fields using camelCase
//! (`oldText` / `newText` / `filePath`); the Cadencr frontend's diff
//! renderer expects the canonical Anthropic-style snake_case keys
//! (`old_string` / `new_string` / `file_path`). This module owns the
//! single rewrite path. Split out of `adapter.rs` to keep that file under
//! the 400-line ceiling.

use serde_json::Value;

/// Rename ACP-flavoured edit-tool keys to the canonical Anthropic-style
/// keys the FE diff renderer expects. Operates only on known edit tool
/// names (Edit / MultiEdit / Write / ApplyPatch — `ApplyPatch` shares the
/// same key shape per the ACP schema) so other tool inputs pass through
/// unchanged.
pub fn normalize_edit_input(tool_name: &str, mut input: Value) -> Value {
    if !matches!(tool_name, "Edit" | "MultiEdit" | "Write" | "ApplyPatch") {
        return input;
    }
    let Some(map) = input.as_object_mut() else {
        return input;
    };
    rename_key(map, "oldText", "old_string");
    rename_key(map, "newText", "new_string");
    rename_key(map, "filePath", "file_path");
    if !map.contains_key("file_path") {
        if let Some(path) = map.remove("path") {
            map.insert("file_path".to_string(), path);
        }
    }
    input
}

fn rename_key(map: &mut serde_json::Map<String, Value>, from: &str, to: &str) {
    if map.contains_key(to) {
        return;
    }
    if let Some(value) = map.remove(from) {
        map.insert(to.to_string(), value);
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_edit_input;
    use serde_json::{json, Value};

    #[test]
    fn normalize_rewrites_acp_edit_keys() {
        let normalized = normalize_edit_input(
            "Edit",
            json!({ "path": "/x", "oldText": "a", "newText": "b" }),
        );
        assert_eq!(normalized["file_path"], "/x");
        assert_eq!(normalized["old_string"], "a");
        assert_eq!(normalized["new_string"], "b");
        assert!(normalized.get("path").is_none());
        assert!(normalized.get("oldText").is_none());
        assert!(normalized.get("newText").is_none());
    }

    #[test]
    fn normalize_leaves_existing_canonical_keys_untouched() {
        let normalized = normalize_edit_input(
            "Edit",
            json!({ "file_path": "/x", "old_string": "a", "new_string": "b" }),
        );
        assert_eq!(normalized["file_path"], "/x");
        assert_eq!(normalized["old_string"], "a");
        assert_eq!(normalized["new_string"], "b");
    }

    #[test]
    fn normalize_apply_patch_matches_edit_normalization() {
        // ApplyPatch shares the ACP edit-tool key shape; rewrite must match Edit.
        let raw = json!({ "filePath": "/x", "oldText": "a", "newText": "b" });
        assert_eq!(
            normalize_edit_input("Edit", raw.clone()),
            normalize_edit_input("ApplyPatch", raw)
        );
    }

    #[test]
    fn normalize_skips_non_edit_tools() {
        let raw = json!({ "path": "/x", "command": "ls" });
        let normalized = normalize_edit_input("Bash", raw.clone());
        assert_eq!(normalized, raw);
    }

    #[test]
    fn normalize_returns_non_object_inputs_unchanged() {
        let normalized = normalize_edit_input("Edit", Value::Null);
        assert!(normalized.is_null());
    }
}
