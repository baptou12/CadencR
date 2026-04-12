use serde_json::{json, Value};

pub(crate) fn canonical_tool_name(name: String) -> String {
    match name.as_str() {
        "bash" => "Bash".to_string(),
        "read" => "Read".to_string(),
        "write" => "Write".to_string(),
        "edit" => "Edit".to_string(),
        "glob" => "Glob".to_string(),
        "grep" => "Grep".to_string(),
        "task" => "Task".to_string(),
        "agent" => "Agent".to_string(),
        "apply_patch" => "ApplyPatch".to_string(),
        _ => name,
    }
}

pub(crate) fn tool_input_from_state(part: &Value) -> Value {
    let base = part
        .get("state")
        .and_then(|state| state.get("input"))
        .cloned()
        .or_else(|| part.get("input").cloned())
        .or_else(|| part.get("args").cloned())
        .unwrap_or_else(|| json!({}));

    let Some(state) = part.get("state") else {
        return base;
    };
    let mut enriched = base.as_object().cloned().unwrap_or_default();
    if let Some(args) = nested_object(state, &["output", "metadata"])
        .and_then(|value| value.get("args"))
        .and_then(Value::as_object)
    {
        for (key, value) in args {
            enriched.insert(key.clone(), value.clone());
        }
    }
    if let Some(output) = state
        .get("output")
        .cloned()
        .filter(|value| !value.is_null())
    {
        enriched.insert("output".to_string(), output);
    } else if let Some(output) = state
        .get("metadata")
        .and_then(|metadata| metadata.get("output"))
        .cloned()
        .filter(|value| !value.is_null())
    {
        enriched.insert("output".to_string(), output);
    }
    if let Some(status) = state
        .get("status")
        .cloned()
        .filter(|value| !value.is_null())
    {
        enriched.insert("status".to_string(), status);
    }
    if let Some(title) = state.get("title").cloned().filter(|value| !value.is_null()) {
        enriched.insert("title".to_string(), title);
    }
    normalize_common_tool_input(&mut enriched);
    Value::Object(enriched)
}

fn normalize_common_tool_input(input: &mut serde_json::Map<String, Value>) {
    move_key(input, "filePath", "file_path");
    move_key(input, "oldString", "old_string");
    move_key(input, "newString", "new_string");
    move_key(input, "patchText", "patch_text");
}

fn move_key(input: &mut serde_json::Map<String, Value>, from: &str, to: &str) {
    if input.contains_key(to) {
        let _ = input.remove(from);
        return;
    }
    if let Some(value) = input.remove(from) {
        input.insert(to.to_string(), value);
    }
}

fn nested_object<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter()
        .find_map(|key| value.get(*key).filter(|nested| nested.is_object()))
}

#[cfg(test)]
mod tests {
    use super::{canonical_tool_name, tool_input_from_state};
    use serde_json::json;

    #[test]
    fn canonical_tool_name_maps_known_aliases() {
        assert_eq!(canonical_tool_name("bash".to_string()), "Bash");
        assert_eq!(canonical_tool_name("apply_patch".to_string()), "ApplyPatch");
        assert_eq!(
            canonical_tool_name("custom_tool".to_string()),
            "custom_tool"
        );
    }

    #[test]
    fn tool_input_normalizes_common_keys_and_enriches_metadata() {
        let input = tool_input_from_state(&json!({
            "state": {
                "status": "completed",
                "title": "done",
                "input": {
                    "filePath": "/tmp/a.txt",
                    "oldString": "old",
                    "newString": "new",
                    "patchText": "*** Begin Patch\n*** End Patch"
                },
                "output": "ok"
            }
        }));

        assert_eq!(input["file_path"], "/tmp/a.txt");
        assert_eq!(input["old_string"], "old");
        assert_eq!(input["new_string"], "new");
        assert_eq!(input["patch_text"], "*** Begin Patch\n*** End Patch");
        assert_eq!(input["status"], "completed");
        assert_eq!(input["title"], "done");
        assert_eq!(input["output"], "ok");
    }
}
