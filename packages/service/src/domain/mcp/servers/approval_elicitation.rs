use rmcp::{
    model::{CreateElicitationRequestParams, ElicitationAction, ElicitationSchema, Meta},
    service::{RequestContext, RoleServer},
};
use serde_json::{json, Value};

pub async fn maybe_elicit_tool_approval(
    context: &RequestContext<RoleServer>,
    server_name: &str,
    tool_name: &str,
    tool_input: &Value,
) -> Result<(), String> {
    if std::env::var("CADENCE_MCP_APPROVAL_MODE").ok().as_deref() != Some("elicitation") {
        return Ok(());
    }
    if !matches!(tool_name, "show_plan" | "show_prd") {
        return Ok(());
    }

    let response = context
        .peer
        .create_elicitation(CreateElicitationRequestParams::FormElicitationParams {
            meta: Some(meta(server_name, tool_name, tool_input)),
            message: format!("Approve {tool_name}"),
            requested_schema: ElicitationSchema::builder()
                .required_bool("approved")
                .build()
                .map_err(ToOwned::to_owned)?,
        })
        .await
        .map_err(|error| format!("Approval request failed: {error}"))?;

    match response.action {
        ElicitationAction::Accept => Ok(()),
        ElicitationAction::Decline => Err(format!("{tool_name} was denied by the user")),
        ElicitationAction::Cancel => Err(format!("{tool_name} approval was cancelled")),
    }
}

fn meta(server_name: &str, tool_name: &str, tool_input: &Value) -> Meta {
    let mut meta = serde_json::Map::new();
    meta.insert(
        "tool_name".to_string(),
        Value::String(format!("mcp__{server_name}__{tool_name}")),
    );
    meta.insert("tool_input".to_string(), tool_input.clone());
    meta.insert("requested_by".to_string(), json!("cadence"));
    Meta(meta)
}
