use serde_json::{json, Value};

pub(super) fn schema(target_session_description: &str) -> Value {
    json!({
        "type": "object",
        "properties": {
            "target_session_id": {
                "type": "number",
                "description": target_session_description
            },
            "message": {
                "type": "string",
                "description": "Follow-up message to deliver to the target session."
            },
            "message_uuid": {
                "type": "string",
                "description": "Stable UUID for explicitly retrying the same logical message."
            },
            "delivery": {
                "type": "string",
                "enum": ["steer_current_turn", "next_turn", "reject_if_active"],
                "default": "steer_current_turn",
                "description": "Delivery policy. steer_current_turn is the default and injects into an active turn; next_turn is the only queueing mode; reject_if_active fails when busy. Legacy aliases remain accepted but are deprecated."
            },
            "reply": {
                "type": "string",
                "enum": ["none", "on_turn_end"],
                "default": "none",
                "description": "Set on_turn_end to receive the target turn result automatically as a reactive <cadencr-reply>; never poll for it."
            },
            "source_note": {
                "type": "string",
                "description": "Optional provenance note recorded with the generated message."
            },
            "link_to_current_session": {
                "type": "boolean",
                "description": "Whether to create a messaged session link from the current session; defaults to true."
            }
        },
        "required": ["target_session_id", "message"]
    })
}
