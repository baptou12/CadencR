use std::collections::HashMap;
use std::sync::Arc;

use codex_app_server_sdk_rs::AppServerEvent;
use tokio::sync::{broadcast, mpsc, Mutex, RwLock};

use super::event_items::IndexState;
use super::event_system::{permission_request_event, request_key};
use super::events::{notification_events, turn_id_from_started};
use super::permissions::PendingCodexRequest;
use crate::domain::agents::adapter::{RuntimeError, RuntimeEvent};

pub(super) fn spawn_event_loop(
    mut source_rx: broadcast::Receiver<AppServerEvent>,
    tx: mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    pending_requests: Arc<Mutex<HashMap<String, PendingCodexRequest>>>,
    active_turn_id: Arc<RwLock<Option<String>>>,
    model: Arc<RwLock<Option<String>>>,
) {
    tokio::spawn(async move {
        let mut command_outputs = HashMap::new();
        let mut index_state = IndexState::default();
        loop {
            match source_rx.recv().await {
                Ok(AppServerEvent::Notification { method, mut params }) => {
                    update_turn_state(&method, &params, &active_turn_id).await;
                    clear_resolved_request(&method, &params, &pending_requests).await;
                    enrich_command_output(&method, &mut params, &mut command_outputs);
                    let current_model = model.read().await.clone();
                    for event in notification_events(
                        &method,
                        params,
                        current_model.as_deref(),
                        &mut index_state,
                    ) {
                        if tx.send(Ok(event)).await.is_err() {
                            return;
                        }
                    }
                }
                Ok(AppServerEvent::ServerRequest { id, method, params }) => {
                    pending_requests.lock().await.insert(
                        request_key(&id),
                        PendingCodexRequest {
                            id: id.clone(),
                            method: method.clone(),
                            params: params.clone(),
                        },
                    );
                    let event = permission_request_event(&id, &method, &params);
                    if tx.send(Ok(event)).await.is_err() {
                        return;
                    }
                }
                Ok(AppServerEvent::ProcessExited) | Err(broadcast::error::RecvError::Closed) => {
                    let _ = tx
                        .send(Err(RuntimeError::new("Codex app-server exited")))
                        .await;
                    return;
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {}
            }
        }
    });
}

async fn update_turn_state(
    method: &str,
    params: &serde_json::Value,
    active_turn_id: &Arc<RwLock<Option<String>>>,
) {
    if method == "turn/started" {
        if let Some(turn_id) = turn_id_from_started(params) {
            *active_turn_id.write().await = Some(turn_id);
        }
    }
    if method == "turn/completed" {
        *active_turn_id.write().await = None;
    }
}

async fn clear_resolved_request(
    method: &str,
    params: &serde_json::Value,
    pending_requests: &Arc<Mutex<HashMap<String, PendingCodexRequest>>>,
) {
    if method != "serverRequest/resolved" {
        return;
    }
    if let Some(request_id) = params.get("requestId") {
        pending_requests
            .lock()
            .await
            .remove(&request_key(request_id));
    }
}

fn enrich_command_output(
    method: &str,
    params: &mut serde_json::Value,
    command_outputs: &mut HashMap<String, String>,
) {
    match method {
        "item/commandExecution/outputDelta" | "command/exec/outputDelta" => {
            let Some(item_id) = params.get("itemId").and_then(serde_json::Value::as_str) else {
                return;
            };
            let delta = params
                .get("delta")
                .or_else(|| params.get("message"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let output = command_outputs.entry(item_id.to_string()).or_default();
            output.push_str(delta);
            if let Some(object) = params.as_object_mut() {
                object.insert(
                    "aggregatedOutput".to_string(),
                    serde_json::Value::String(output.clone()),
                );
            }
        }
        "item/completed" => enrich_completed_command(params, command_outputs),
        _ => {}
    }
}

fn enrich_completed_command(
    params: &mut serde_json::Value,
    command_outputs: &mut HashMap<String, String>,
) {
    let Some(item) = params
        .get_mut("item")
        .and_then(serde_json::Value::as_object_mut)
    else {
        return;
    };
    if item.get("type").and_then(serde_json::Value::as_str) != Some("commandExecution") {
        return;
    }
    let Some(item_id) = item
        .get("id")
        .and_then(serde_json::Value::as_str)
        .map(ToOwned::to_owned)
    else {
        return;
    };
    if !item.contains_key("aggregatedOutput") {
        if let Some(output) = command_outputs.get(&item_id) {
            item.insert(
                "aggregatedOutput".to_string(),
                serde_json::Value::String(output.clone()),
            );
        }
    }
    command_outputs.remove(&item_id);
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use serde_json::json;
    use tokio::sync::{Mutex, RwLock};

    use super::super::event_system::request_key;
    use super::super::permissions::PendingCodexRequest;
    use super::{clear_resolved_request, enrich_command_output, update_turn_state};

    #[tokio::test]
    async fn turn_started_and_completed_update_active_turn_state() {
        let active_turn_id = Arc::new(RwLock::new(None));

        update_turn_state(
            "turn/started",
            &json!({ "turn": { "id": "turn_1" } }),
            &active_turn_id,
        )
        .await;
        assert_eq!(active_turn_id.read().await.as_deref(), Some("turn_1"));

        update_turn_state("turn/completed", &json!({}), &active_turn_id).await;
        assert!(active_turn_id.read().await.is_none());
    }

    #[tokio::test]
    async fn server_request_resolved_clears_matching_pending_request() {
        let request_id = json!("approval_1");
        let pending = Arc::new(Mutex::new(HashMap::from([(
            request_key(&request_id),
            PendingCodexRequest {
                id: request_id.clone(),
                method: "item/commandExecution/requestApproval".to_string(),
                params: json!({}),
            },
        )])));

        clear_resolved_request(
            "serverRequest/resolved",
            &json!({ "requestId": request_id }),
            &pending,
        )
        .await;

        assert!(pending.lock().await.is_empty());
    }

    #[test]
    fn command_output_deltas_are_attached_to_completed_command() {
        let mut outputs = HashMap::new();
        let mut first = json!({ "itemId": "cmd_1", "delta": "hello " });
        let mut second = json!({ "itemId": "cmd_1", "delta": "world" });
        enrich_command_output(
            "item/commandExecution/outputDelta",
            &mut first,
            &mut outputs,
        );
        enrich_command_output(
            "item/commandExecution/outputDelta",
            &mut second,
            &mut outputs,
        );

        assert_eq!(second["aggregatedOutput"], json!("hello world"));

        let mut completed = json!({
            "item": {
                "type": "commandExecution",
                "id": "cmd_1",
                "command": "echo hello"
            }
        });
        enrich_command_output("item/completed", &mut completed, &mut outputs);

        assert_eq!(completed["item"]["aggregatedOutput"], json!("hello world"));
        assert!(outputs.is_empty());
    }
}
