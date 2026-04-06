use super::*;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::sync::Mutex;

fn make_sender() -> (WsSender, mpsc::UnboundedReceiver<Message>) {
    mpsc::unbounded_channel()
}

fn recv_envelope(rx: &mut mpsc::UnboundedReceiver<Message>) -> WsEnvelope {
    match rx.try_recv().unwrap() {
        Message::Text(text) => serde_json::from_str::<WsEnvelope>(&text).unwrap(),
        _ => panic!("expected text message"),
    }
}

fn make_envelope(action: &str, payload: serde_json::Value) -> WsEnvelope {
    WsEnvelope {
        id: "test-id-123".to_string(),
        domain: "workflow".to_string(),
        action: action.to_string(),
        r#ref: None,
        payload,
    }
}

// --- send_workflow_error tests ---

#[test]
fn test_send_workflow_error_produces_correct_envelope() {
    let (tx, mut rx) = make_sender();
    send_workflow_error(&tx, "ref-42", "NO_ENGINE", "Engine not found");

    let env = recv_envelope(&mut rx);
    assert_eq!(env.domain, "workflow");
    assert_eq!(env.action, "error");
    assert_eq!(env.r#ref.as_deref(), Some("ref-42"));

    let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
    assert_eq!(payload.code, "NO_ENGINE");
    assert_eq!(payload.message, "Engine not found");
}

// --- parse_payload tests ---

#[test]
fn test_parse_payload_valid() {
    let (tx, mut _rx) = make_sender();
    let envelope = make_envelope("skip_item", serde_json::json!({"feature_id": 1, "item_id": 5}));
    let result = parse_payload::<WorkflowSkipItemPayload>(&envelope, &tx);
    assert!(result.is_some());
    let p = result.unwrap();
    assert_eq!(p.feature_id, 1);
    assert_eq!(p.item_id, 5);
}

#[test]
fn test_parse_payload_invalid_sends_error() {
    let (tx, mut rx) = make_sender();
    let envelope = make_envelope("skip_item", serde_json::json!({"wrong_field": true}));
    let result = parse_payload::<WorkflowSkipItemPayload>(&envelope, &tx);
    assert!(result.is_none());

    let env = recv_envelope(&mut rx);
    assert_eq!(env.action, "error");
    let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
    assert_eq!(payload.code, "INVALID_PAYLOAD");
}

// --- parse_and_get_engine tests ---

#[test]
fn test_parse_and_get_engine_invalid_payload() {
    let (tx, mut rx) = make_sender();
    let envelope = make_envelope("continue", serde_json::json!({}));
    let result = parse_and_get_engine::<WorkflowContinuePayload>(&envelope, &tx);
    assert!(result.is_none());

    let env = recv_envelope(&mut rx);
    let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
    assert_eq!(payload.code, "INVALID_PAYLOAD");
}

#[test]
fn test_parse_and_get_engine_no_engine() {
    let (tx, mut rx) = make_sender();
    let envelope = make_envelope("continue", serde_json::json!({"feature_id": 99999}));
    let result = parse_and_get_engine::<WorkflowContinuePayload>(&envelope, &tx);
    assert!(result.is_none());

    let env = recv_envelope(&mut rx);
    let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
    assert_eq!(payload.code, "NO_ENGINE");
    assert!(payload.message.contains("99999"));
}

// --- handle_workflow_action unknown action test ---

#[tokio::test]
async fn test_unknown_workflow_action_returns_error() {
    let (tx, mut rx) = make_sender();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
    let app_state = AppState::with_pool(pool);

    let envelope = make_envelope("totally_bogus_action", serde_json::json!({}));
    handle_workflow_action(envelope, &tx, &sdk_sessions, &app_state).await;

    let env = recv_envelope(&mut rx);
    assert_eq!(env.action, "error");
    let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
    assert_eq!(payload.code, "UNKNOWN_ACTION");
    assert!(payload.message.contains("totally_bogus_action"));
}

// --- Action routing: missing engine returns NO_ENGINE ---

/// Helper: dispatch an action and assert the error code.
async fn assert_action_error(action: &str, payload: serde_json::Value, expected_code: &str) {
    let (tx, mut rx) = make_sender();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
    let app_state = AppState::with_pool(pool);
    let envelope = make_envelope(action, payload);
    handle_workflow_action(envelope, &tx, &sdk_sessions, &app_state).await;
    let env = recv_envelope(&mut rx);
    assert_eq!(env.action, "error");
    let p: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
    assert_eq!(p.code, expected_code, "action={action}");
}

#[tokio::test]
async fn test_no_engine_errors() {
    let slot = serde_json::json!({"type": "queue_item", "id": 1});
    let cases: Vec<(&str, serde_json::Value)> = vec![
        ("continue", serde_json::json!({"feature_id": 12345})),
        ("skip_item", serde_json::json!({"feature_id": 12345, "item_id": 1})),
        ("retry_item", serde_json::json!({"feature_id": 12345, "item_id": 1})),
        ("set_parallel", serde_json::json!({"feature_id": 12345, "enabled": false})),
        ("set_autonomy", serde_json::json!({"feature_id": 12345, "level": 2})),
        ("permission.respond", serde_json::json!({"feature_id": 12345, "agent_slot": slot.clone(), "request_id": "r1", "decision": "allow_once"})),
        ("prompt.send", serde_json::json!({"feature_id": 12345, "agent_slot": slot.clone(), "text": "hello"})),
        ("mark_done", serde_json::json!({"feature_id": 12345, "agent_slot": slot})),
    ];
    for (action, payload) in cases {
        assert_action_error(action, payload, "NO_ENGINE").await;
    }
}

// --- Invalid payload routing tests ---

#[tokio::test]
async fn test_invalid_payload_errors() {
    let cases: Vec<(&str, serde_json::Value)> = vec![
        ("continue", serde_json::json!({"wrong": true})),
        ("skip_item", serde_json::json!({})),
    ];
    for (action, payload) in cases {
        assert_action_error(action, payload, "INVALID_PAYLOAD").await;
    }
}

// --- to_value helper test ---

#[test]
fn test_to_value_helper() {
    let val = to_value(WorkflowAcknowledgedPayload {
        feature_id: 1,
        action: "test".into(),
    });
    assert_eq!(val["feature_id"], 1);
    assert_eq!(val["action"], "test");
}

// --- Engine registry tests ---

#[test]
fn test_get_engine_returns_none_for_unknown_feature() {
    assert!(get_engine(999888777).is_none());
}

#[test]
fn test_detach_engine_sender_no_panic_for_unknown_feature() {
    detach_engine_sender(999888776);
}

#[test]
fn test_tracked_feature_ids_type() {
    let _ids: Vec<i64> = tracked_feature_ids();
}

// --- format_qa_answer tests ---

#[test]
fn test_format_qa_single_pair() {
    let raw = "What is the goal?\nAnswer: Build a widget";
    let result = workflow_interact::format_qa_answer(raw);
    assert_eq!(result, "*What is the goal?*\n\n**Build a widget**");
}

#[test]
fn test_format_qa_multiple_pairs() {
    let raw = "First question?\nAnswer: First answer\n\nSecond question?\nAnswer: Second answer";
    let result = workflow_interact::format_qa_answer(raw);
    assert_eq!(
        result,
        "*First question?*\n\n**First answer**\n\n\n\n*Second question?*\n\n**Second answer**"
    );
}

// --- Guard isolation tests ---

async fn setup_guard_test_db() -> (sqlx::SqlitePool, i64, i64) {
    let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
    sqlx::query(
        "CREATE TABLE features (id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT, type TEXT, workflow_definition_id INTEGER)"
    ).execute(&pool).await.unwrap();
    let legacy_id: i64 = sqlx::query("INSERT INTO features (project_id, title, type) VALUES (1, 'Legacy', 'ws-feature')")
        .execute(&pool).await.unwrap().last_insert_rowid();
    let custom_id: i64 = sqlx::query("INSERT INTO features (project_id, title, type, workflow_definition_id) VALUES (1, 'Custom', 'ws-feature', 42)")
        .execute(&pool).await.unwrap().last_insert_rowid();
    (pool, legacy_id, custom_id)
}

#[tokio::test]
async fn test_custom_action_rejected_on_legacy_feature() {
    let (pool, legacy_id, _custom_id) = setup_guard_test_db().await;
    let (tx, mut rx) = make_sender();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = AppState::with_pool(pool);

    let envelope = make_envelope("phase_approval", serde_json::json!({
        "feature_id": legacy_id,
        "phase_slug": "design",
        "approved": true
    }));
    handle_workflow_action(envelope, &tx, &sdk_sessions, &app_state).await;

    let env = recv_envelope(&mut rx);
    assert_eq!(env.action, "error");
    let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
    assert_eq!(payload.code, "WRONG_WORKFLOW_TYPE");
}

#[tokio::test]
async fn test_legacy_action_rejected_on_custom_feature() {
    let (pool, _legacy_id, custom_id) = setup_guard_test_db().await;
    let (tx, mut rx) = make_sender();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = AppState::with_pool(pool);

    let envelope = make_envelope("start_plan", serde_json::json!({
        "feature_id": custom_id,
        "description": "test",
        "images": []
    }));
    handle_workflow_action(envelope, &tx, &sdk_sessions, &app_state).await;

    let env = recv_envelope(&mut rx);
    assert_eq!(env.action, "error");
    let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
    assert_eq!(payload.code, "WRONG_WORKFLOW_TYPE");
}

#[tokio::test]
async fn test_phase_trigger_rejected_on_legacy_feature() {
    let (pool, legacy_id, _custom_id) = setup_guard_test_db().await;
    let (tx, mut rx) = make_sender();
    let sdk_sessions: SdkSessions = Arc::new(Mutex::new(HashMap::new()));
    let app_state = AppState::with_pool(pool);

    let envelope = make_envelope("phase_trigger", serde_json::json!({
        "feature_id": legacy_id,
        "phase_slug": "design"
    }));
    handle_workflow_action(envelope, &tx, &sdk_sessions, &app_state).await;

    let env = recv_envelope(&mut rx);
    assert_eq!(env.action, "error");
    let payload: SessionErrorPayload = serde_json::from_value(env.payload).unwrap();
    assert_eq!(payload.code, "WRONG_WORKFLOW_TYPE");
}

#[test]
fn test_format_qa_no_answer_prefix() {
    let raw = "Question?\nJust a plain answer";
    let result = workflow_interact::format_qa_answer(raw);
    assert_eq!(result, "*Question?*\n\n**Just a plain answer**");
}

#[test]
fn test_format_qa_multiline_answer() {
    let raw = "Question?\nAnswer: Line one\nLine two";
    let result = workflow_interact::format_qa_answer(raw);
    assert_eq!(result, "*Question?*\n\n**Line one\nLine two**");
}

#[test]
fn test_format_qa_question_only() {
    let raw = "Just a question?";
    let result = workflow_interact::format_qa_answer(raw);
    assert_eq!(result, "*Just a question?*\n\n****");
}
