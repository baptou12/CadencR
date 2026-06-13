use std::future::Future;

use rmcp::model::{CallToolResult, Content};

/// Extract a required i64 parameter from JSON args, returning a clear error if missing.
#[allow(dead_code)]
pub fn require_i64(args: &serde_json::Value, key: &str) -> Result<i64, String> {
    args[key]
        .as_i64()
        .ok_or_else(|| format!("Missing required parameter: {key}"))
}

/// Returns the subprocess-pinned feature id after confirming it matches any
/// `feature_id` the tool's arguments supply — blocks confused-deputy
/// cross-feature attacks.
pub fn pinned_feature_id(args: &serde_json::Value, pinned: i64) -> Result<i64, String> {
    if let Some(arg_fid) = args.get("feature_id").and_then(|v| v.as_i64()) {
        if arg_fid != pinned {
            return Err(format!(
                "feature_id mismatch: subprocess is pinned to {pinned}, but tool call \
                 supplied {arg_fid}"
            ));
        }
    }
    Ok(pinned)
}

/// Wraps text in a successful tool result
pub fn text_result(text: &str) -> CallToolResult {
    CallToolResult::success(vec![Content::text(text)])
}

/// Wraps error message in an error tool result
pub fn error_result(msg: &str) -> CallToolResult {
    CallToolResult::error(vec![Content::text(msg)])
}

#[allow(dead_code)]
pub async fn dispatch_tool<Fut>(dispatch: Fut) -> CallToolResult
where
    Fut: Future<Output = Result<String, String>>,
{
    match dispatch.await {
        Ok(text) => text_result(&text),
        Err(e) => error_result(&e),
    }
}

#[cfg(test)]
mod tests {
    use super::pinned_feature_id;
    use serde_json::json;

    #[tokio::test]
    async fn pinned_feature_id_returns_pin_when_args_empty() {
        assert_eq!(pinned_feature_id(&json!({}), 42).unwrap(), 42);
    }

    #[tokio::test]
    async fn pinned_feature_id_allows_matching_arg() {
        assert_eq!(
            pinned_feature_id(&json!({ "feature_id": 7 }), 7).unwrap(),
            7
        );
    }

    #[tokio::test]
    async fn pinned_feature_id_rejects_mismatched_arg() {
        // Defense in depth: a prompt-injected agent that tries to switch
        // features via the tool-call argument gets an explicit error.
        let err = pinned_feature_id(&json!({ "feature_id": 99 }), 7).unwrap_err();
        assert!(err.contains("mismatch"), "got: {err}");
    }
}
