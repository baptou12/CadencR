use rmcp::model::{CallToolResult, Content};

/// Wraps text in a successful tool result
pub fn text_result(text: &str) -> CallToolResult {
    CallToolResult::success(vec![Content::text(text)])
}

/// Wraps error message in an error tool result
pub fn error_result(msg: &str) -> CallToolResult {
    CallToolResult::error(vec![Content::text(msg)])
}
