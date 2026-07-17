//! Preserve the standard ACP metadata that makes tool calls understandable.
//!
//! ACP agents are allowed to omit `rawInput`, but every tool call has a
//! human-readable `title` and may include file `locations`. Cadencr stores tool
//! arguments as one JSON value, so this module projects that metadata into the
//! canonical input object consumed by persistence and the frontend.

use serde_json::{Map, Value};

pub(super) fn enrich_tool_input(body: &Value, input: Value) -> Value {
    if !has_input_metadata(body) {
        return input;
    }

    let mut object = input_object(input);
    insert_description(body, &mut object);
    insert_locations(body, &mut object);
    Value::Object(object)
}

pub(super) fn has_input_metadata(body: &Value) -> bool {
    nonempty_string(body.get("title")).is_some()
        || body
            .get("locations")
            .and_then(Value::as_array)
            .is_some_and(|locations| !locations.is_empty())
}

pub(super) fn merge_tool_input(existing: Option<&Value>, incoming: Value) -> Value {
    match (existing, incoming) {
        (Some(Value::Object(existing)), Value::Object(incoming)) => {
            let mut merged = existing.clone();
            merged.extend(incoming);
            Value::Object(merged)
        }
        (Some(existing), incoming) if is_empty_value(&incoming) => existing.clone(),
        (_, incoming) => incoming,
    }
}

fn input_object(input: Value) -> Map<String, Value> {
    match input {
        Value::Object(object) => object,
        input if is_empty_value(&input) => Map::new(),
        input => Map::from_iter([("rawInput".to_string(), input)]),
    }
}

fn insert_description(body: &Value, object: &mut Map<String, Value>) {
    if object.contains_key("description") {
        return;
    }
    if let Some(title) = nonempty_string(body.get("title")) {
        object.insert("description".to_string(), Value::String(title.to_string()));
    }
}

fn insert_locations(body: &Value, object: &mut Map<String, Value>) {
    let Some(locations) = body
        .get("locations")
        .and_then(Value::as_array)
        .filter(|locations| !locations.is_empty())
    else {
        return;
    };

    object
        .entry("locations".to_string())
        .or_insert_with(|| Value::Array(locations.clone()));
    let Some(primary) = locations.first().and_then(Value::as_object) else {
        return;
    };
    if !has_path(object) {
        if let Some(path) = nonempty_string(primary.get("path")) {
            object.insert("path".to_string(), Value::String(path.to_string()));
        }
    }
    if !object.contains_key("line") {
        if let Some(line) = primary.get("line").and_then(Value::as_u64) {
            object.insert("line".to_string(), Value::Number(line.into()));
        }
    }
}

fn has_path(object: &Map<String, Value>) -> bool {
    ["path", "file_path", "filePath"]
        .into_iter()
        .any(|key| nonempty_string(object.get(key)).is_some())
}

fn nonempty_string(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

pub(super) fn is_empty_value(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Object(object) => object.is_empty(),
        Value::Array(array) => array.is_empty(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::{enrich_tool_input, has_input_metadata, merge_tool_input};
    use serde_json::{json, Value};

    #[test]
    fn title_and_primary_location_enrich_empty_input() {
        let enriched = enrich_tool_input(
            &json!({
                "title": "Read the provider adapter",
                "locations": [{ "path": "/repo/adapter.rs", "line": 42 }]
            }),
            Value::Null,
        );

        assert_eq!(enriched["description"], "Read the provider adapter");
        assert_eq!(enriched["path"], "/repo/adapter.rs");
        assert_eq!(enriched["line"], 42);
        assert_eq!(enriched["locations"][0]["path"], "/repo/adapter.rs");
    }

    #[test]
    fn explicit_input_wins_over_acp_fallbacks() {
        let enriched = enrich_tool_input(
            &json!({
                "title": "Generic title",
                "locations": [{ "path": "/fallback.rs" }]
            }),
            json!({ "description": "Precise description", "file_path": "/actual.rs" }),
        );

        assert_eq!(enriched["description"], "Precise description");
        assert_eq!(enriched["file_path"], "/actual.rs");
        assert!(enriched.get("path").is_none());
    }

    #[test]
    fn later_input_merges_with_start_metadata() {
        let existing = json!({
            "description": "Search source files",
            "path": "/repo"
        });
        let merged = merge_tool_input(
            Some(&existing),
            json!({ "pattern": "normalize_tool_input" }),
        );

        assert_eq!(merged["description"], "Search source files");
        assert_eq!(merged["path"], "/repo");
        assert_eq!(merged["pattern"], "normalize_tool_input");
    }

    #[test]
    fn detects_only_meaningful_metadata() {
        assert!(!has_input_metadata(
            &json!({ "title": "", "locations": [] })
        ));
        assert!(has_input_metadata(&json!({ "title": "Search code" })));
        assert!(has_input_metadata(
            &json!({ "locations": [{ "path": "/repo" }] })
        ));
    }
}
