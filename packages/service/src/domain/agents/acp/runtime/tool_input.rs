use serde_json::{Map, Value};

/// Normalize ACP edit-tool fields into the provider-neutral shape consumed by
/// the desktop renderers.
pub(crate) fn normalize_edit_input(tool_name: &str, mut input: Value) -> Value {
    if !matches!(tool_name, "Edit" | "MultiEdit" | "Write" | "ApplyPatch") {
        return input;
    }
    let Some(map) = input.as_object_mut() else {
        return input;
    };
    rename_key(map, "filePath", "file_path");
    rename_key(map, "path", "file_path");
    if tool_name == "Write" {
        rename_key(map, "newText", "content");
        map.remove("oldText");
    } else {
        rename_key(map, "oldText", "old_string");
        rename_key(map, "newText", "new_string");
    }
    input
}

pub(crate) fn rename_key(map: &mut Map<String, Value>, from: &str, to: &str) {
    if map.contains_key(to) {
        return;
    }
    if let Some(value) = map.remove(from) {
        map.insert(to.to_string(), value);
    }
}
