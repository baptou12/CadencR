use serde_json::Value;

const BASH_OUTPUT_DELTA_KEY: &str = "__cadencr_output_delta";

/// Accumulates streamed tool-input JSON consistently for canonical projection
/// and database persistence, including providers that send replacement values
/// or incremental Bash/file-operation snapshots.
#[derive(Debug, Clone)]
pub(crate) struct RuntimeToolInputBuffer {
    accumulated: String,
    replacement_candidate: Option<String>,
    merge_object_deltas: bool,
}

impl RuntimeToolInputBuffer {
    pub(crate) fn new(tool_name: &str, initial: &Value) -> Self {
        let merge_object_deltas = should_merge_object_deltas(tool_name);
        Self {
            accumulated: if merge_object_deltas {
                serde_json::to_string(initial).unwrap_or_default()
            } else {
                String::new()
            },
            replacement_candidate: None,
            merge_object_deltas,
        }
    }

    pub(crate) fn apply_delta(&mut self, partial_json: &str) -> Option<Value> {
        if self.merge_object_deltas {
            if let Some(parsed) = self.apply_object_delta(partial_json) {
                return Some(parsed);
            }
        }

        let appended = format!("{}{partial_json}", self.accumulated);
        if let Ok(parsed) = serde_json::from_str::<Value>(&appended) {
            self.accumulated = appended;
            self.replacement_candidate = None;
            return Some(parsed);
        }

        if self.replacement_candidate.is_some() || partial_json.trim_start().starts_with('{') {
            let replacement = self.replacement_candidate.get_or_insert_with(String::new);
            replacement.push_str(partial_json);
            if let Ok(parsed) = serde_json::from_str::<Value>(replacement) {
                self.accumulated = replacement.clone();
                self.replacement_candidate = None;
                return Some(parsed);
            }
        }

        None
    }

    pub(crate) fn accumulated(&self) -> &str {
        &self.accumulated
    }

    pub(crate) fn materialized_value(self) -> Option<Value> {
        let raw = self
            .replacement_candidate
            .filter(|candidate| !candidate.is_empty())
            .unwrap_or(self.accumulated);
        if raw.is_empty() {
            None
        } else {
            Some(serde_json::from_str(&raw).unwrap_or(Value::String(raw)))
        }
    }

    fn apply_object_delta(&mut self, partial_json: &str) -> Option<Value> {
        let delta = serde_json::from_str::<Value>(partial_json).ok()?;
        let delta_object = delta.as_object()?;
        let mut base = if self.accumulated.is_empty() {
            serde_json::Map::new()
        } else {
            serde_json::from_str::<Value>(&self.accumulated)
                .ok()?
                .as_object()
                .cloned()?
        };
        if let Some(output_delta) = delta_object
            .get(BASH_OUTPUT_DELTA_KEY)
            .and_then(Value::as_str)
        {
            let prior_output = base.get("output").and_then(Value::as_str).unwrap_or("");
            base.insert(
                "output".to_string(),
                Value::String(format!("{prior_output}{output_delta}")),
            );
        }
        for (key, value) in delta_object {
            if key != BASH_OUTPUT_DELTA_KEY {
                base.insert(key.clone(), value.clone());
            }
        }
        let parsed = Value::Object(base);
        self.accumulated = serde_json::to_string(&parsed).ok()?;
        self.replacement_candidate = None;
        Some(parsed)
    }
}

fn should_merge_object_deltas(tool_name: &str) -> bool {
    tool_name == "Bash" || is_file_change_tool_name(tool_name)
}

pub(crate) fn is_file_change_tool_name(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "Write" | "Edit" | "NotebookEdit" | "ApplyPatch" | "apply_patch"
    )
}

#[cfg(test)]
mod tests {
    use super::RuntimeToolInputBuffer;
    use serde_json::json;

    #[test]
    fn complete_json_deltas_replace_the_previous_snapshot() {
        let mut buffer = RuntimeToolInputBuffer::new("Read", &json!({}));
        buffer.apply_delta(r#"{"path":"first"}"#);
        buffer.apply_delta(r#"{"path":"second"}"#);
        assert_eq!(
            buffer.materialized_value(),
            Some(json!({ "path": "second" }))
        );
    }

    #[test]
    fn bash_output_delta_patches_accumulate_output() {
        let mut buffer = RuntimeToolInputBuffer::new(
            "Bash",
            &json!({ "command": "printf hi", "status": "running" }),
        );
        for chunk in ["hi", " there"] {
            buffer.apply_delta(
                &json!({
                    "__cadencr_output_delta": chunk,
                    "status": "running"
                })
                .to_string(),
            );
        }
        assert_eq!(
            buffer.materialized_value(),
            Some(json!({
                "command": "printf hi",
                "status": "running",
                "output": "hi there"
            }))
        );
    }
}
