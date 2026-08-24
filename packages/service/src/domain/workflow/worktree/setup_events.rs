//! Canonical WebSocket envelopes for worktree setup state and output.

use super::envelope::send_envelope;
use crate::domain::workflow::ws_sender::WsSender;
use crate::shared::setup_log::setup_log_for_transport;

pub(super) fn send_running(feature_id: i64, sender: &WsSender) {
    send_envelope(
        sender,
        "workflow",
        "worktree.setup_running",
        serde_json::json!({ "feature_id": feature_id }),
    );
}

pub(super) fn send_output_line(feature_id: i64, sender: &WsSender, line: String) {
    send_envelope(
        sender,
        "workflow",
        "worktree.setup_output",
        serde_json::json!({ "feature_id": feature_id, "line": line }),
    );
}

pub(super) fn send_output_snapshot(feature_id: i64, sender: &WsSender, log: &str) -> String {
    let output = setup_log_for_transport(log.to_string());
    if !output.is_empty() {
        send_envelope(
            sender,
            "workflow",
            "worktree.setup_output",
            serde_json::json!({
                "feature_id": feature_id,
                "line": output,
                "replace": true,
            }),
        );
    }
    output
}

pub(super) fn send_ready(feature_id: i64, sender: &WsSender, log: &str) {
    send_output_snapshot(feature_id, sender, log);
    send_envelope(
        sender,
        "workflow",
        "worktree.ready",
        serde_json::json!({ "feature_id": feature_id }),
    );
}

pub(super) fn send_error(feature_id: i64, sender: &WsSender, error: &str, log: &str) {
    let output = setup_log_for_transport(log.to_string());
    send_envelope(
        sender,
        "workflow",
        "worktree.setup_error",
        serde_json::json!({
            "feature_id": feature_id,
            "error": error,
            "output": output,
        }),
    );
}
