#[cfg(test)]
mod session_tool_input_buffer_tests {
    use super::*;

    #[test]
    fn bash_output_delta_append_patches_accumulate_output() {
        let mut buffer = RuntimeToolInputBuffer::new(
            "Bash",
            &serde_json::json!({
                "command": "printf hi",
                "status": "running"
            }),
        );

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
            serde_json::from_str::<serde_json::Value>(buffer.accumulated()).expect("valid json"),
            serde_json::json!({
                "command": "printf hi",
                "status": "running",
                "output": "hi there"
            })
        );
    }
}
