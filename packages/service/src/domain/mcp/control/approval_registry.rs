//! Waiters for service-owned approval gates.
//!
//! A control-plane tool that needs a human "yes" raises an ordinary permission
//! gate and parks a oneshot here. The gate looks like any other permission
//! prompt to the frontend, but its answer must never reach a provider runtime:
//! whoever resolves it looks the waiter up first and short-circuits.

use std::collections::HashMap;

use tokio::sync::{oneshot, Mutex};

/// Marks a `tool_input` as belonging to a service-owned approval gate. It
/// survives in the persisted `pending_permission` row, so restart cleanup and
/// the agent-response carve-out can recognize the gate without the in-memory
/// map.
pub const SERVICE_GATE_MARKER: &str = "__cadencr_service_gate";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApprovalOutcome {
    Approved,
    Denied { feedback: Option<String> },
}

#[derive(Default)]
pub struct ToolApprovalRegistry {
    waiters: Mutex<HashMap<(i64, String), oneshot::Sender<ApprovalOutcome>>>,
}

impl ToolApprovalRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Park a waiter *before* the gate is advertised: an answer can land while
    /// the raising task is still broadcasting.
    pub async fn insert(
        &self,
        session_id: i64,
        request_id: &str,
    ) -> oneshot::Receiver<ApprovalOutcome> {
        let (sender, receiver) = oneshot::channel();
        self.waiters
            .lock()
            .await
            .insert((session_id, request_id.to_string()), sender);
        receiver
    }

    /// Claim the waiter. Returns `None` when the gate is not service-owned, or
    /// when another path already answered it.
    pub async fn take(
        &self,
        session_id: i64,
        request_id: &str,
    ) -> Option<oneshot::Sender<ApprovalOutcome>> {
        self.waiters
            .lock()
            .await
            .remove(&(session_id, request_id.to_string()))
    }

    pub async fn contains(&self, session_id: i64, request_id: &str) -> bool {
        self.waiters
            .lock()
            .await
            .contains_key(&(session_id, request_id.to_string()))
    }
}

/// Whether a persisted/registered gate payload carries the service marker.
pub fn is_service_gate_payload(payload: &serde_json::Value) -> bool {
    payload
        .get("tool_input")
        .and_then(|input| input.get(SERVICE_GATE_MARKER))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_parked_waiter_is_claimed_exactly_once() {
        let registry = ToolApprovalRegistry::new();
        let receiver = registry.insert(7, "r1").await;
        assert!(registry.contains(7, "r1").await);

        let sender = registry.take(7, "r1").await.expect("first claim wins");
        assert!(registry.take(7, "r1").await.is_none());
        assert!(!registry.contains(7, "r1").await);

        sender.send(ApprovalOutcome::Approved).unwrap();
        assert_eq!(receiver.await.unwrap(), ApprovalOutcome::Approved);
    }

    #[tokio::test]
    async fn waiters_are_keyed_by_session_and_request() {
        let registry = ToolApprovalRegistry::new();
        let _receiver = registry.insert(7, "r1").await;

        assert!(registry.take(8, "r1").await.is_none());
        assert!(registry.take(7, "other").await.is_none());
        assert!(registry.take(7, "r1").await.is_some());
    }

    #[tokio::test]
    async fn dropping_the_registry_wakes_the_waiter_without_an_answer() {
        let registry = ToolApprovalRegistry::new();
        let receiver = registry.insert(7, "r1").await;
        drop(registry);

        assert!(receiver.await.is_err());
    }

    #[test]
    fn only_a_marked_tool_input_counts_as_service_owned() {
        assert!(is_service_gate_payload(&serde_json::json!({
            "tool_input": { SERVICE_GATE_MARKER: true }
        })));
        assert!(!is_service_gate_payload(&serde_json::json!({
            "tool_input": { "file_path": "/tmp/x" }
        })));
        assert!(!is_service_gate_payload(&serde_json::json!({})));
    }
}
