impl ToolInputBuffer {
    fn apply_delta(&mut self, partial_json: &str) -> Option<serde_json::Value> {
        if self.merge_object_deltas {
            if let Some(parsed) = self.apply_object_delta(partial_json) {
                return Some(parsed);
            }
        }

        let appended = format!("{}{partial_json}", self.accumulated);
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&appended) {
            self.accumulated = appended;
            self.replacement_candidate = None;
            return Some(parsed);
        }

        if self.replacement_candidate.is_some() || partial_json.trim_start().starts_with('{') {
            let replacement = self.replacement_candidate.get_or_insert_with(String::new);
            replacement.push_str(partial_json);
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(replacement) {
                self.accumulated = replacement.clone();
                self.replacement_candidate = None;
                return Some(parsed);
            }
        }

        None
    }

    fn apply_object_delta(&mut self, partial_json: &str) -> Option<serde_json::Value> {
        let delta = serde_json::from_str::<serde_json::Value>(partial_json).ok()?;
        let delta_object = delta.as_object()?;
        let mut base = if self.accumulated.is_empty() {
            serde_json::Map::new()
        } else {
            serde_json::from_str::<serde_json::Value>(&self.accumulated)
                .ok()?
                .as_object()
                .cloned()?
        };
        if let Some(output_delta) = delta_object
            .get(BASH_OUTPUT_DELTA_KEY)
            .and_then(serde_json::Value::as_str)
        {
            let prior_output = base
                .get("output")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            base.insert(
                "output".to_string(),
                serde_json::Value::String(format!("{prior_output}{output_delta}")),
            );
        }
        for (key, value) in delta_object {
            if key == BASH_OUTPUT_DELTA_KEY {
                continue;
            }
            base.insert(key.clone(), value.clone());
        }
        let parsed = serde_json::Value::Object(base);
        self.accumulated = serde_json::to_string(&parsed).ok()?;
        self.replacement_candidate = None;
        Some(parsed)
    }
}

const BASH_OUTPUT_DELTA_KEY: &str = "__cadencr_output_delta";

fn should_merge_tool_object_deltas(tool_name: &str) -> bool {
    tool_name == "Bash" || is_file_change_tool_name(tool_name)
}

fn is_file_change_tool_name(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "Write" | "Edit" | "NotebookEdit" | "ApplyPatch" | "apply_patch"
    )
}

#[cfg(test)]
mod session_tool_input_buffer_tests {
    use super::*;

    fn bash_buffer() -> ToolInputBuffer {
        ToolInputBuffer {
            accumulated: serde_json::json!({
                "command": "printf hi",
                "status": "running"
            })
            .to_string(),
            replacement_candidate: None,
            merge_object_deltas: true,
        }
    }

    #[test]
    fn bash_output_delta_append_patches_accumulate_output() {
        let mut buffer = bash_buffer();

        for chunk in ["hi", " there"] {
            buffer.apply_delta(
                &serde_json::json!({
                    "__cadencr_output_delta": chunk,
                    "status": "running"
                })
                .to_string(),
            );
        }

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&buffer.accumulated).expect("valid json"),
            serde_json::json!({
                "command": "printf hi",
                "status": "running",
                "output": "hi there"
            })
        );
    }
}
