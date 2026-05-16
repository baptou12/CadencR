//! Top-level [`query`] constructor: spawns the Claude CLI subprocess,
//! sends the `initialize` handshake, writes the first user prompt, and
//! starts the background reader task that feeds the [`Query`] stream.

use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};
use tracing::{debug, info};

use crate::error::SdkError;
use crate::options::Options;
use crate::transport::{find_cli, CliProcess};

use super::query_struct::Query;
use super::reader::reader_loop;
use super::turn_state::TurnState;
use super::wire::{build_control_request, write_to_stdin, PendingControl};

/// Spawn a Claude CLI query and return a streaming [`Query`] handle.
///
/// The `Query` implements [`Stream<Item = Result<SdkMessage, SdkError>>`].
/// Iterate it with `while let Some(msg) = query.next().await` using
/// [`StreamExt`](futures::StreamExt).
///
/// # Turn management
///
/// - While streaming, [`Query::turn_state()`] is [`TurnState::AgentWorking`]
/// - When a `Result` message arrives, it becomes [`TurnState::TurnComplete`]
/// - When `canUseTool` blocks, it becomes [`TurnState::WaitingForPermission`]
///
/// # Example
///
/// ```no_run
/// use claude_agent_sdk_rs::{query, Options, TurnState};
/// use futures::StreamExt;
///
/// # async fn example() -> Result<(), claude_agent_sdk_rs::SdkError> {
/// let options = Options::default();
/// let mut q = query("Hello Claude".into(), options).await?;
///
/// while let Some(msg) = q.next().await {
///     match msg {
///         Ok(msg) => println!("{msg:?}"),
///         Err(e) => eprintln!("error: {e}"),
///     }
/// }
/// # Ok(())
/// # }
/// ```
pub async fn query(content: serde_json::Value, mut options: Options) -> Result<Query, SdkError> {
    let cli_path = find_cli(options.path_to_cli.as_deref()).await?;
    let mut process = CliProcess::spawn(&cli_path, &options).await?;

    // Capture PID before moving process into reader loop.
    let pid = process.pid();
    info!(pid = ?pid, cli = %cli_path.display(), "CLI process spawned");

    // Take stdin out of the process — Query and the reader loop share it
    // via Arc<Mutex<..>> so the reader loop can write permission responses
    // and Query can write user messages / control commands.
    let stdin = process.take_stdin();
    let process_stdin = Arc::new(Mutex::new(stdin));

    // Send the initialize control request so the CLI knows we support
    // the bidirectional control protocol (canUseTool, AskUserQuestion, etc.).
    let (_init_request_id, init_msg) = build_control_request(
        "init",
        serde_json::json!({
            "subtype": "initialize",
            "systemPrompt": options.system_prompt.as_deref(),
        }),
    );
    debug!("sending initialize control_request to CLI stdin");
    write_to_stdin(&process_stdin, &init_msg).await?;

    // Write initial prompt to stdin
    let prompt_msg = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": content },
        "parent_tool_use_id": null,
        "session_id": ""
    });
    write_to_stdin(&process_stdin, &prompt_msg).await?;

    // Extract runtime-only fields from options
    let can_use_tool = options.can_use_tool.take();
    let cancel_token = options.abort_signal.take();

    // Set up channel and shared state
    let (tx, rx) = mpsc::channel(256);
    let (interrupt_tx, interrupt_rx) = mpsc::channel(4);
    let (kill_tx, kill_rx) = mpsc::channel(1);
    let session_id = Arc::new(Mutex::new(None));
    let turn_state = Arc::new(Mutex::new(TurnState::AgentWorking));
    let pending_control: PendingControl = Arc::new(Mutex::new(HashMap::new()));
    let control_request_counter = Arc::new(AtomicU64::new(0));

    // Spawn background reader
    let reader_task = tokio::spawn(reader_loop(
        process,
        Arc::clone(&process_stdin),
        tx,
        can_use_tool,
        Arc::clone(&session_id),
        Arc::clone(&turn_state),
        Arc::clone(&pending_control),
        cancel_token.clone(),
        interrupt_rx,
        kill_rx,
    ));

    Ok(Query {
        message_rx: rx,
        process_stdin,
        session_id,
        turn_state,
        pending_control,
        control_request_counter,
        reader_task: Some(reader_task),
        interrupt_tx,
        kill_tx,
        _cancel_token: cancel_token,
        pid,
    })
}

#[cfg(test)]
mod tests {
    use crate::messages::SdkMessage;
    use crate::options::Options;
    use futures::StreamExt;
    use tempfile::TempDir;

    use super::super::test_support::write_mock_cli;
    use super::query;

    #[tokio::test]
    async fn query_sends_initialize_and_skips_control_response() {
        let dir = TempDir::new().unwrap();

        // Mock CLI: read the initialize request, respond with control_response,
        // then read the user prompt, emit system init + result.
        // The control_response should NOT appear as an SDK message.
        let script = r#"#!/bin/sh
read -r INIT_REQ
echo '{"type":"control_response","response":{"subtype":"success","request_id":"init_test","response":{"pid":1234}}}'
read -r USER_PROMPT
echo '{"type":"system","subtype":"init","uuid":"u1","session_id":"sess_init","claude_code_version":"1.0","cwd":"/tmp","tools":[],"mcp_servers":[],"model":"claude-sonnet-4-20250514","permission_mode":"default","slash_commands":[],"output_style":"stream","skills":[],"plugins":[]}'
echo '{"type":"result","subtype":"success","uuid":"u2","session_id":"sess_init","duration_ms":10,"duration_api_ms":5,"is_error":false,"num_turns":1,"result":"ok","errors":null,"stop_reason":"end_turn","total_cost_usd":0.0,"usage":{"input_tokens":1,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"permission_denials":[],"structured_output":null}'
"#;
        let script_path = write_mock_cli(dir.path(), script);

        let options = Options {
            path_to_cli: Some(script_path),
            ..Options::default()
        };

        let mut q = query(serde_json::Value::String("test".into()), options)
            .await
            .unwrap();

        let mut messages = Vec::new();
        while let Some(msg) = q.next().await {
            messages.push(msg.unwrap());
        }

        // control_response should be filtered out — only System(Init) + Result
        assert_eq!(
            messages.len(),
            2,
            "expected 2 messages, got {}",
            messages.len()
        );
        assert!(messages
            .iter()
            .all(|m| !matches!(m, SdkMessage::Unknown(v) if v.get("type").and_then(|t| t.as_str()) == Some("control_response"))));

        let sid = q.session_id().await;
        assert_eq!(sid, Some("sess_init".to_string()));
    }
}
