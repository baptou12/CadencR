//! End-to-end proof that a locally selected ACP executable becomes a usable
//! provider without a single provider-specific source change.
//!
//! The agent under test is `tests/fixtures/fake_acp_agent.py`: a deterministic
//! ACP v1 process that implements only the baseline (`initialize`,
//! `session/new`, `session/prompt`, `session/cancel`) and answers "method not
//! found" to everything else. If Cadencr needed any optional capability to
//! drive it, these tests would fail.
//!
//! Scope is deliberately the end-to-end path only. Descriptor validation and
//! every refusal code are covered by the inline unit tests in
//! `providers/installed/loader.rs`, which exercise the same pure `load_from_dir`
//! without a subprocess.

mod common;

use std::path::{Path, PathBuf};
use std::time::Duration;

use cadencr_service::domain::agents::adapter::{
    AgentRuntimeAdapter, RuntimeSessionConfigKind, RuntimeSessionConfigValue,
};
use cadencr_service::domain::agents::providers::installed;
use cadencr_service::domain::agents::providers::installed::rejection::{
    QuarantineCode, RejectionCode,
};
use cadencr_service::domain::agents::providers::installed::routes::InstalledProvidersResponse;
use cadencr_service::domain::agents::providers::provider_registry;
use cadencr_service::domain::agents::runtime::ProviderStatus;
use cadencr_service::domain::ws_session::protocol::{
    PromptSendPayload, SessionActionPayload, SessionConfigSetPayload, SessionConfigSnapshotPayload,
    SessionEndedPayload, SessionInitPayload, SessionInitializedPayload, SessionMessagePayload,
    WsEnvelope, WsSessionAction,
};
use common::{start_migrated_test_server, TEST_AUTH_TOKEN};
use futures::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

const PROVIDER_ID: &str = "fake-acp-agent";
const CONFIG_PROVIDER_ID: &str = "fake-config-acp-agent";
const QUARANTINED_PROVIDER_ID: &str = "quarantined-acp-agent";
const EVENT_TIMEOUT: Duration = Duration::from_secs(10);

type TestWebSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

fn fixture_agent() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/fake_acp_agent.py")
        .canonicalize()
        .expect("fake ACP agent fixture should exist")
}

fn descriptor(id: &str, command: &Path) -> Value {
    json!({
        "schema_version": 1,
        "agent": {
            "id": id,
            "name": "Fake ACP Agent",
            "version": "1.0.0",
            "description": "Deterministic ACP v1 agent used in tests",
            "repository": "https://example.invalid/fake-acp-agent",
            "license": "MIT",
        },
        "installation": {
            "executable": { "command": command.to_string_lossy() },
        },
    })
}

fn write_descriptor(dir: &Path, name: &str, value: &Value) {
    std::fs::write(
        dir.join(name),
        serde_json::to_string_pretty(value).expect("descriptor should serialize"),
    )
    .expect("descriptor should be writable");
}

fn event_deadline() -> Instant {
    Instant::now() + EVENT_TIMEOUT
}

async fn send_session_payload(
    socket: &mut TestWebSocket,
    action: &str,
    payload: impl Serialize,
) -> String {
    let envelope = WsEnvelope::new(
        "session",
        action,
        serde_json::to_value(payload).expect("session payload should serialize"),
    );
    let id = envelope.id.clone();
    socket
        .send(Message::Text(String::from(envelope).into()))
        .await
        .expect("WebSocket message should send");
    id
}

async fn next_ws_envelope(socket: &mut TestWebSocket, deadline: Instant) -> WsEnvelope {
    loop {
        let message = tokio::time::timeout_at(deadline, socket.next())
            .await
            .expect("timed out waiting for a WebSocket envelope")
            .expect("WebSocket closed before the expected envelope")
            .expect("WebSocket read should succeed");
        match message {
            Message::Text(text) => {
                return WsEnvelope::try_from(text.to_string())
                    .expect("server text should be a valid WsEnvelope")
            }
            Message::Ping(payload) => socket
                .send(Message::Pong(payload))
                .await
                .expect("pong should send"),
            Message::Close(frame) => panic!("WebSocket closed unexpectedly: {frame:?}"),
            Message::Binary(_) | Message::Pong(_) | Message::Frame(_) => {}
        }
    }
}

async fn next_session_action(socket: &mut TestWebSocket, action: WsSessionAction) -> WsEnvelope {
    let deadline = event_deadline();
    loop {
        let envelope = next_ws_envelope(socket, deadline).await;
        if envelope.domain != "session" {
            continue;
        }
        assert_ne!(
            envelope.action, "error",
            "unexpected WebSocket session error: {}",
            envelope.payload
        );
        if envelope.action == action.as_str() {
            return envelope;
        }
        assert_ne!(
            envelope.action,
            WsSessionAction::Ended.as_str(),
            "session ended before the expected {} action",
            action.as_str()
        );
    }
}

fn message_text(payload: &SessionMessagePayload) -> String {
    payload
        .blocks
        .iter()
        .filter(|block| {
            block.pointer("/event/type").and_then(Value::as_str) == Some("content_block_delta")
                && block.pointer("/event/delta/type").and_then(Value::as_str) == Some("text_delta")
        })
        .filter_map(|block| block.pointer("/event/delta/text").and_then(Value::as_str))
        .collect()
}

async fn collect_ws_turn(socket: &mut TestWebSocket) -> (String, SessionEndedPayload) {
    let deadline = event_deadline();
    let mut text = String::new();
    let mut previous_seq = 0;
    loop {
        let envelope = next_ws_envelope(socket, deadline).await;
        if envelope.domain != "session" {
            continue;
        }
        match envelope.action.as_str() {
            "message" => {
                let payload: SessionMessagePayload = serde_json::from_value(envelope.payload)
                    .expect("session.message payload should match its DTO");
                let seq = payload.seq.expect("streamed messages carry a sequence");
                assert!(seq > previous_seq, "message sequence must increase");
                previous_seq = seq;
                text.push_str(&message_text(&payload));
            }
            "ended" => {
                let payload = serde_json::from_value(envelope.payload)
                    .expect("session.ended payload should match its DTO");
                return (text, payload);
            }
            "error" => panic!("unexpected WebSocket session error: {}", envelope.payload),
            _ => {}
        }
    }
}

async fn next_ws_text(socket: &mut TestWebSocket) -> String {
    let deadline = event_deadline();
    loop {
        let envelope = next_ws_envelope(socket, deadline).await;
        if envelope.domain != "session" {
            continue;
        }
        match envelope.action.as_str() {
            "message" => {
                let payload: SessionMessagePayload = serde_json::from_value(envelope.payload)
                    .expect("session.message payload should match its DTO");
                let text = message_text(&payload);
                if !text.is_empty() {
                    return text;
                }
            }
            "ended" => panic!("session ended before streaming text: {}", envelope.payload),
            "error" => panic!("unexpected WebSocket session error: {}", envelope.payload),
            _ => {}
        }
    }
}

fn prompt_payload(session_id: &str, text: &str) -> PromptSendPayload {
    PromptSendPayload {
        session_id: session_id.to_string(),
        text: text.to_string(),
        profile: None,
        claude_profile: None,
        images: Vec::new(),
        attachments: Vec::new(),
        use_worktree: Some(false),
        new_project_branch: None,
        message_uuid: None,
        track_prompt_receipt: false,
    }
}

/// The headline case: drop a descriptor next to the settings, and the agent is
/// selectable, can create a session, streams a prompt, and cancels.
#[tokio::test]
async fn a_local_acp_executable_is_selectable_and_drives_a_full_turn() {
    let home = tempfile::tempdir().expect("settings dir");
    let providers = home.path().join("providers");
    std::fs::create_dir_all(&providers).expect("providers dir");
    let agent = fixture_agent();
    write_descriptor(
        &providers,
        "fake-acp-agent.json",
        &descriptor(PROVIDER_ID, &agent),
    );
    let mut config_descriptor = descriptor(CONFIG_PROVIDER_ID, &agent);
    config_descriptor["installation"]["executable"]["args"] = json!(["--session-config"]);
    write_descriptor(&providers, "fake-config-acp-agent.json", &config_descriptor);
    // A second descriptor claiming a built-in id must lose to the built-in.
    write_descriptor(&providers, "cursor.json", &descriptor("cursor", &agent));
    write_descriptor(
        &providers,
        "quarantined-acp-agent.json",
        &descriptor(
            QUARANTINED_PROVIDER_ID,
            &home.path().join("missing-acp-binary"),
        ),
    );
    cadencr_service::domain::settings_store::init(home.path().to_path_buf());

    // --- catalog -----------------------------------------------------------
    let registry = provider_registry();
    let ids = registry.provider_ids();
    assert_eq!(
        ids,
        vec![
            "claude_code",
            "codex_cli",
            "cursor",
            "opencode",
            PROVIDER_ID,
            CONFIG_PROVIDER_ID,
            QUARANTINED_PROVIDER_ID,
        ],
        "built-ins keep their order and the install is appended"
    );
    let adapter = registry
        .adapter(PROVIDER_ID)
        .expect("the installed provider should resolve");
    let entry = adapter.catalog_entry();
    assert_eq!(entry.label, "Fake ACP Agent");
    assert_eq!(entry.status, ProviderStatus::Available);
    assert!(
        entry.models.is_empty() && entry.modes.is_empty() && entry.default_model.is_none(),
        "models and modes are negotiated per session, never declared by a descriptor"
    );
    // The colliding descriptor was refused, and `cursor` still resolves to the
    // built-in adapter.
    let rejections = &installed::startup_load().rejections;
    assert_eq!(rejections.len(), 1, "{rejections:?}");
    assert_eq!(rejections[0].code.as_str(), "DUPLICATE_PROVIDER_ID");
    assert_eq!(rejections[0].provider_id.as_deref(), Some("cursor"));
    assert_eq!(
        registry
            .adapter("cursor")
            .expect("cursor")
            .catalog_entry()
            .label,
        cadencr_service::domain::agents::cursor::CursorAdapter
            .catalog_entry()
            .label
    );

    // --- authenticated HTTP diagnostics -----------------------------------
    let server = start_migrated_test_server().await;
    let response = server
        .client
        .get(format!(
            "{}/api/agents/installed-providers",
            server.base_url
        ))
        .send()
        .await
        .expect("installed-provider diagnostics request");
    assert_eq!(response.status(), 200);
    let diagnostics: InstalledProvidersResponse =
        response.json().await.expect("diagnostics response DTO");
    let fake = diagnostics
        .installed
        .iter()
        .find(|entry| entry.id == PROVIDER_ID)
        .expect("fake provider diagnostics");
    assert!(fake.registered);
    assert!(fake.quarantine_code.is_none());
    let quarantined = diagnostics
        .installed
        .iter()
        .find(|entry| entry.id == QUARANTINED_PROVIDER_ID)
        .expect("quarantined provider diagnostics");
    assert!(quarantined.registered);
    assert_eq!(
        quarantined.quarantine_code.as_deref(),
        Some(QuarantineCode::ExecutableNotFound.as_str())
    );
    let collision = diagnostics
        .rejected
        .iter()
        .find(|rejection| rejection.provider_id.as_deref() == Some("cursor"))
        .expect("built-in collision diagnostics");
    assert_eq!(collision.code, RejectionCode::DuplicateProviderId.as_str());

    let unauthenticated = reqwest::Client::new()
        .get(format!(
            "{}/api/agents/installed-providers",
            server.base_url
        ))
        .send()
        .await
        .expect("unauthenticated diagnostics request");
    assert_eq!(unauthenticated.status(), 401);

    // --- real WebSocket session path --------------------------------------
    let ws_url = format!("{}/ws", server.base_url.replacen("http://", "ws://", 1));
    let mut request = ws_url
        .into_client_request()
        .expect("valid WebSocket request");
    request.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        HeaderValue::from_str(&format!("cadencr-token.{TEST_AUTH_TOKEN}"))
            .expect("valid protocol header"),
    );
    let (mut socket, response) = tokio_tungstenite::connect_async(request)
        .await
        .expect("authenticated WebSocket should connect");
    assert_eq!(response.status(), 101);

    let init_id = send_session_payload(
        &mut socket,
        "init",
        SessionInitPayload {
            provider: Some(PROVIDER_ID.to_string()),
            model: None,
            thinking_effort: None,
            permission_mode: None,
            system_prompt: None,
            cwd: Some(server.repo_path().to_string_lossy().into_owned()),
            feature_id: Some(1),
        },
    )
    .await;
    let initialized_envelope = next_session_action(&mut socket, WsSessionAction::Initialized).await;
    assert_eq!(
        initialized_envelope.r#ref.as_deref(),
        Some(init_id.as_str())
    );
    let initialized: SessionInitializedPayload =
        serde_json::from_value(initialized_envelope.payload)
            .expect("session.initialized payload should match its DTO");
    assert_eq!(initialized.provider.as_deref(), Some(PROVIDER_ID));
    let session_id = initialized.session_id;

    send_session_payload(
        &mut socket,
        "prompt.send",
        prompt_payload(&session_id, "say hello"),
    )
    .await;
    let (streamed_text, ended) = collect_ws_turn(&mut socket).await;
    assert_eq!(streamed_text, "Hello from the fake ACP agent.");
    assert_eq!(ended.reason, "turn_complete");
    let persisted: (String, Option<String>) = sqlx::query_as(
        "SELECT runtime_provider, runtime_session_id FROM agent_sessions WHERE id = ?",
    )
    .bind(session_id.parse::<i64>().expect("numeric session id"))
    .fetch_one(&server.pool)
    .await
    .expect("persisted session");
    assert_eq!(persisted.0, PROVIDER_ID);
    assert_eq!(persisted.1.as_deref(), Some("fake-acp-session-1"));

    // Cancellation crosses the same public WebSocket boundary. Wait for the
    // first chunk so the interrupt cannot race session/prompt startup.
    send_session_payload(
        &mut socket,
        "prompt.send",
        prompt_payload(&session_id, "hang until cancelled"),
    )
    .await;
    assert_eq!(next_ws_text(&mut socket).await, "Hello ");
    send_session_payload(
        &mut socket,
        "interrupt",
        SessionActionPayload {
            session_id,
            message_uuid: None,
        },
    )
    .await;
    let (_, ended) = collect_ws_turn(&mut socket).await;
    assert_eq!(ended.reason, "turn_interrupted");

    // The optional ACP v1 configuration bridge is exercised through the same
    // authenticated public WebSocket, without a desktop consumer or a
    // provider-specific adapter.
    sqlx::query(
        "INSERT INTO features (id, project_id, title, type) \
         VALUES (2, 1, 'Configured ACP Feature', 'ws-session')",
    )
    .execute(&server.pool)
    .await
    .expect("configured ACP feature");
    sqlx::query(
        "INSERT INTO feature_settings (feature_id, key, value) \
         VALUES (2, 'worktree_path', ?)",
    )
    .bind(server.repo_path().to_string_lossy().as_ref())
    .execute(&server.pool)
    .await
    .expect("configured ACP worktree path");
    let init_id = send_session_payload(
        &mut socket,
        "init",
        SessionInitPayload {
            provider: Some(CONFIG_PROVIDER_ID.to_string()),
            model: None,
            thinking_effort: None,
            permission_mode: None,
            system_prompt: None,
            cwd: Some(server.repo_path().to_string_lossy().into_owned()),
            feature_id: Some(2),
        },
    )
    .await;
    let initialized_envelope = next_session_action(&mut socket, WsSessionAction::Initialized).await;
    assert_eq!(
        initialized_envelope.r#ref.as_deref(),
        Some(init_id.as_str())
    );
    let initialized: SessionInitializedPayload =
        serde_json::from_value(initialized_envelope.payload)
            .expect("configured session.initialized payload should match its DTO");
    assert_eq!(initialized.provider.as_deref(), Some(CONFIG_PROVIDER_ID));
    let config_session_id = initialized.session_id;
    send_session_payload(
        &mut socket,
        "prompt.send",
        prompt_payload(&config_session_id, "start configured runtime"),
    )
    .await;
    let (streamed_text, ended) = collect_ws_turn(&mut socket).await;
    assert_eq!(streamed_text, "Hello from the fake ACP agent.");
    assert_eq!(ended.reason, "turn_complete");

    let get_id = send_session_payload(
        &mut socket,
        "config.get",
        SessionActionPayload {
            session_id: config_session_id.clone(),
            message_uuid: None,
        },
    )
    .await;
    let snapshot_envelope = next_session_action(&mut socket, WsSessionAction::ConfigSnapshot).await;
    assert_eq!(snapshot_envelope.r#ref.as_deref(), Some(get_id.as_str()));
    let snapshot: SessionConfigSnapshotPayload = serde_json::from_value(snapshot_envelope.payload)
        .expect("configuration snapshot should match its DTO");
    assert_eq!(snapshot.config.options[0].id, "safe_mode");
    assert!(matches!(
        snapshot.config.options[0].kind,
        RuntimeSessionConfigKind::Boolean {
            current_value: false
        }
    ));

    let set_id = send_session_payload(
        &mut socket,
        "config.set",
        SessionConfigSetPayload {
            session_id: config_session_id,
            config_id: "safe_mode".to_string(),
            value: RuntimeSessionConfigValue::Boolean(true),
        },
    )
    .await;
    let snapshot_envelope = next_session_action(&mut socket, WsSessionAction::ConfigSnapshot).await;
    assert_eq!(snapshot_envelope.r#ref.as_deref(), Some(set_id.as_str()));
    let snapshot: SessionConfigSnapshotPayload = serde_json::from_value(snapshot_envelope.payload)
        .expect("updated configuration snapshot should match its DTO");
    assert!(matches!(
        snapshot.config.options[0].kind,
        RuntimeSessionConfigKind::Boolean {
            current_value: true
        }
    ));
    socket.close(None).await.expect("WebSocket should close");
}
