use axum::extract::ws::Message;
use tokio::sync::mpsc;

use crate::domain::workflow::engine::*;

use super::helpers::*;

#[test]
fn test_ws_sender_detach_drops_messages() {
    let (ws, mut rx) = test_ws_sender();

    ws.detach();
    let result = ws.send(Message::Text("hello".into()));
    assert!(result.is_ok(), "send on detached sender should return Ok");
    assert!(
        rx.try_recv().is_err(),
        "no message should arrive after detach"
    );
}

#[test]
fn test_ws_sender_reattach_restores_delivery() {
    let (ws, _rx) = test_ws_sender();

    ws.detach();
    assert!(ws.send(Message::Text("dropped".into())).is_ok());

    let (tx2, mut rx2) = mpsc::unbounded_channel();
    ws.reattach(tx2);
    ws.send(Message::Text("delivered".into())).unwrap();

    let msg = rx2.try_recv().unwrap();
    if let Message::Text(text) = msg {
        assert_eq!(&*text, "delivered");
    } else {
        panic!("expected Text message");
    }
}

#[test]
fn test_ws_sender_is_attached_reflects_state() {
    let (ws, _rx) = test_ws_sender();

    assert!(ws.is_attached());
    ws.detach();
    assert!(!ws.is_attached());

    let (tx2, _rx2) = mpsc::unbounded_channel();
    ws.reattach(tx2);
    assert!(ws.is_attached());
}

#[test]
fn test_ws_sender_raw_clone_none_when_detached() {
    let (ws, _rx) = test_ws_sender();

    assert!(ws.raw_clone().is_some());
    ws.detach();
    assert!(ws.raw_clone().is_none());
}

#[test]
fn test_ws_sender_raw_clone_some_when_attached() {
    let (ws, _rx) = test_ws_sender();

    let cloned = ws.raw_clone();
    assert!(cloned.is_some());
    let (tx2, mut rx2) = mpsc::unbounded_channel();
    ws.reattach(tx2);
    let cloned2 = ws.raw_clone().unwrap();
    cloned2.send(Message::Text("via clone".into())).unwrap();
    let msg = rx2.try_recv().unwrap();
    if let Message::Text(text) = msg {
        assert_eq!(&*text, "via clone");
    } else {
        panic!("expected Text message");
    }
}

// ── WorkflowEngine reattach/detach sender ──

#[tokio::test]
async fn test_engine_reattach_sender_updates_sender() {
    let (engine, _rx) = test_engine().await;

    let (tx2, mut rx2) = mpsc::unbounded_channel();
    engine.reattach_sender(tx2);

    engine
        .ws_sender
        .send(Message::Text("after reattach".into()))
        .unwrap();
    let msg = rx2.try_recv().unwrap();
    if let Message::Text(text) = msg {
        assert_eq!(&*text, "after reattach");
    } else {
        panic!("expected Text message");
    }
}

#[tokio::test]
async fn test_engine_detach_sender_makes_has_sender_false() {
    let (engine, _rx) = test_engine().await;

    assert!(engine.has_sender());
    engine.detach_sender();
    assert!(!engine.has_sender());
}

// ── send_feature_updated_envelope helper ──

#[test]
fn test_send_feature_updated_envelope_format() {
    let (ws, mut rx) = test_ws_sender();
    send_feature_updated_envelope(&ws, 123, &["plan", "phases"]);

    let msg = rx.try_recv().unwrap();
    if let Message::Text(text) = msg {
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["domain"], "feature");
        assert_eq!(v["action"], "updated");
        assert_eq!(v["payload"]["feature_id"], 123);
        let changed: Vec<String> = v["payload"]["changed"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect();
        assert_eq!(changed, vec!["plan", "phases"]);
    } else {
        panic!("expected Text message");
    }
}
