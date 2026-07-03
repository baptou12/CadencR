use serde_json::json;

use super::event_payloads::{
    parse_command_execution_params, parse_file_patch_updated_params, parse_item_params,
    parse_raw_response_item_params, parse_serialized_permission_request,
    parse_tool_json_delta_params,
};

#[test]
fn command_execution_params_reject_missing_item() {
    let error = parse_command_execution_params(json!({ "threadId": "thread" }))
        .expect_err("missing item should fail deserialization");

    assert!(error.to_string().contains("item"));
}

#[test]
fn command_output_delta_params_reject_non_string_item_id() {
    let error = parse_tool_json_delta_params(json!({
        "threadId": "thread",
        "itemId": 42,
        "delta": "chunk"
    }))
    .expect_err("non-string itemId should fail deserialization");

    assert!(!error.to_string().is_empty());
}

#[test]
fn item_params_reject_missing_item() {
    let error = parse_item_params(json!({ "threadId": "thread" }))
        .expect_err("missing item should fail deserialization");

    assert!(error.to_string().contains("item"));
}

#[test]
fn file_patch_updated_params_reject_non_array_changes() {
    let error = parse_file_patch_updated_params(json!({
        "threadId": "thread",
        "itemId": "patch",
        "changes": "not an array"
    }))
    .expect_err("non-array changes should fail deserialization");

    assert!(!error.to_string().is_empty());
}

#[test]
fn raw_response_item_params_reject_missing_item() {
    let error = parse_raw_response_item_params(json!({ "threadId": "thread" }))
        .expect_err("missing raw item should fail deserialization");

    assert!(error.to_string().contains("item"));
}

#[test]
fn serialized_permission_request_rejects_missing_request_id() {
    let error = parse_serialized_permission_request(json!({
        "type": "codex_permission_request",
        "tool_name": "Bash"
    }))
    .expect_err("missing request_id should fail deserialization");

    assert!(error.to_string().contains("request_id"));
}
