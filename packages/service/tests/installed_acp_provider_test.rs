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

use std::path::{Path, PathBuf};
use std::time::Duration;

use cadencr_service::domain::agents::adapter::{
    AgentRuntimeAdapter, RuntimeContentDelta, RuntimeEvent, RuntimeSpawnConfig, RuntimeStreamEvent,
};
use cadencr_service::domain::agents::providers::installed;
use cadencr_service::domain::agents::providers::provider_registry;
use cadencr_service::domain::agents::runtime::ProviderStatus;
use serde_json::{json, Value};
use tokio::sync::mpsc::Receiver;

const PROVIDER_ID: &str = "fake-acp-agent";
const EVENT_TIMEOUT: Duration = Duration::from_secs(10);

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

/// Drain runtime events until the turn's `Result` envelope, returning the
/// assistant text streamed along the way.
async fn collect_turn(
    rx: &mut Receiver<Result<RuntimeEvent, cadencr_service::domain::agents::adapter::RuntimeError>>,
) -> (String, Value) {
    let mut text = String::new();
    loop {
        let event = tokio::time::timeout(EVENT_TIMEOUT, rx.recv())
            .await
            .expect("timed out waiting for a runtime event")
            .expect("runtime channel closed before the turn ended")
            .expect("runtime event should not be an error");
        if let Some(RuntimeStreamEvent::ContentBlockDelta {
            delta: RuntimeContentDelta::Text { text: chunk },
            ..
        }) = event.stream_event()
        {
            text.push_str(chunk);
        }
        if event.is_result() {
            return (text, event.raw_json().clone());
        }
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
    // A second descriptor claiming a built-in id must lose to the built-in.
    write_descriptor(&providers, "cursor.json", &descriptor("cursor", &agent));
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
            PROVIDER_ID
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

    // --- session + streaming prompt ----------------------------------------
    let workspace = tempfile::tempdir().expect("workspace");
    let mut session = adapter
        .spawn(
            json!("say hello"),
            RuntimeSpawnConfig {
                cwd: workspace.path().to_path_buf(),
                ..RuntimeSpawnConfig::default()
            },
        )
        .await
        .expect("the installed provider should start a session");
    assert_eq!(
        session.session_id().await.as_deref(),
        Some("fake-acp-session-1"),
        "session/new must be what supplies the runtime session id"
    );
    let mut rx = session.take_message_rx();
    let init = tokio::time::timeout(EVENT_TIMEOUT, rx.recv())
        .await
        .expect("timed out waiting for init")
        .expect("runtime channel")
        .expect("init event");
    assert!(init.init().is_some(), "spawn emits the init envelope first");

    let (text, result) = collect_turn(&mut rx).await;
    assert_eq!(text, "Hello from the fake ACP agent.");
    assert_eq!(result["stop_reason"], "end_turn");
    session.close().await;

    // --- cancellation -------------------------------------------------------
    let mut hanging = adapter
        .spawn(
            json!("hang until cancelled"),
            RuntimeSpawnConfig {
                cwd: workspace.path().to_path_buf(),
                ..RuntimeSpawnConfig::default()
            },
        )
        .await
        .expect("second session should start");
    let mut rx = hanging.take_message_rx();
    let init = tokio::time::timeout(EVENT_TIMEOUT, rx.recv())
        .await
        .expect("timed out waiting for init")
        .expect("runtime channel")
        .expect("init event");
    assert!(init.init().is_some());
    // Wait until the agent has actually started the turn, so the cancel lands
    // against an in-flight prompt rather than racing the first chunk.
    let started = tokio::time::timeout(EVENT_TIMEOUT, async {
        while let Some(event) = rx.recv().await {
            if let Ok(event) = event {
                if matches!(
                    event.stream_event(),
                    Some(RuntimeStreamEvent::ContentBlockDelta { .. })
                ) {
                    return true;
                }
            }
        }
        false
    })
    .await
    .expect("timed out waiting for the first streamed chunk");
    assert!(started);

    hanging
        .interrupt()
        .await
        .expect("cancel should be accepted");
    let (_, result) = collect_turn(&mut rx).await;
    assert_eq!(
        result["stop_reason"], "cancelled",
        "session/cancel must end the turn with the ACP cancelled stop reason"
    );
    hanging.close().await;
}
