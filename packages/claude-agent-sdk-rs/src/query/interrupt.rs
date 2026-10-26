//! Interrupt handling for [`Query`](super::query_struct::Query).

use tokio::time::{sleep, timeout, Duration};

use crate::error::SdkError;

use super::query_struct::Query;
use super::turn_state::TurnState;

const INTERRUPT_TURN_COMPLETE_TIMEOUT: Duration = Duration::from_secs(10);
const INTERRUPT_TURN_COMPLETE_POLL_INTERVAL: Duration = Duration::from_millis(10);

impl Query {
    /// Interrupt the agent and wait until the CLI reports the interrupted turn
    /// as complete. This keeps a replayed steering prompt from being written
    /// while Claude Code is still winding down the old turn.
    pub async fn interrupt(&self) -> Result<(), SdkError> {
        // SIGINT terminates recent stream-json CLIs. The protocol interrupt
        // cancels only the turn and leaves stdin available for follow-ups.
        self.send_control_request(serde_json::json!({ "subtype": "interrupt" }))
            .await?;
        self.wait_for_interrupted_turn_complete().await
    }

    async fn wait_for_interrupted_turn_complete(&self) -> Result<(), SdkError> {
        timeout(INTERRUPT_TURN_COMPLETE_TIMEOUT, async {
            loop {
                if matches!(self.turn_state().await, TurnState::TurnComplete { .. }) {
                    return;
                }
                sleep(INTERRUPT_TURN_COMPLETE_POLL_INTERVAL).await;
            }
        })
        .await
        .map_err(|_| SdkError::Timeout)
    }
}

#[cfg(test)]
mod tests {
    use futures::StreamExt;
    use serde_json::json;
    use tempfile::TempDir;
    use tokio::time::{timeout, Duration};

    use crate::{query, Options, SdkError, SdkMessage, TurnState};

    use super::super::test_support::{mock_mcp_servers, write_mock_cli};

    async fn protocol_interrupt(result_before_ack: bool, reject: bool) {
        let dir = TempDir::new().unwrap();
        let script = format!(
            r#"#!/usr/bin/env python3
import json, signal, sys, time
signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
def send(v): print(json.dumps(v), flush=True)
def ack(v, reject=False):
    send({{"type":"control_response","response":{{"subtype":"error" if reject else "success","request_id":v["request_id"],"error":"interrupt refused","response":{{"mcpServers":[]}}}}}})
def result(text):
    send({{"type":"result","subtype":"success","uuid":"r","session_id":"s","duration_ms":1,"duration_api_ms":1,"is_error":False,"num_turns":1,"result":text,"total_cost_usd":0,"usage":{{"input_tokens":1,"output_tokens":1}}}})
ack(json.loads(sys.stdin.readline()))
ack(json.loads(sys.stdin.readline()))
sys.stdin.readline()
send({{"type":"system","subtype":"init","uuid":"u","session_id":"s","claude_code_version":"test","cwd":"/tmp","tools":[],"mcp_servers":[],"model":"test","permission_mode":"default","slash_commands":[]}})
v=json.loads(sys.stdin.readline())
assert v["type"] == "control_request" and v["request"]["subtype"] == "interrupt", v
if {reject}:
    ack(v, True)
else:
    if {before}: result("interrupted")
    ack(v)
    if not {before}:
        time.sleep(0.05)
        result("interrupted")
    for line in sys.stdin:
        v=json.loads(line)
        assert v["type"] == "user", v
        result(v["message"]["content"])
"#,
            reject = if reject { "True" } else { "False" },
            before = if result_before_ack { "True" } else { "False" },
        );
        let mut q = query(
            json!("initial"),
            Options {
                path_to_cli: Some(write_mock_cli(dir.path(), &script)),
                mcp_servers: Some(mock_mcp_servers()),
                ..Options::default()
            },
        )
        .await
        .unwrap();
        q.next().await.unwrap().unwrap();
        let outcome = timeout(Duration::from_secs(3), q.interrupt()).await;
        if reject {
            assert!(
                matches!(outcome.unwrap(), Err(SdkError::ControlRequestFailed { subtype, .. }) if subtype == "interrupt")
            );
        } else {
            outcome
                .expect("interrupt must complete without killing the CLI")
                .unwrap();
            assert!(matches!(
                q.turn_state().await,
                TurnState::TurnComplete { .. }
            ));
            assert!(matches!(
                q.next().await.unwrap().unwrap(),
                SdkMessage::Result { .. }
            ));
            for text in ["immediate user prompt", "inter-agent reply"] {
                q.stream_input(json!(text)).await.unwrap();
                let event = timeout(Duration::from_secs(3), q.next())
                    .await
                    .unwrap()
                    .unwrap()
                    .unwrap();
                assert!(
                    matches!(event, SdkMessage::Result { result: Some(result), .. } if result == text)
                );
            }
        }
        q.close().await;
    }

    #[tokio::test]
    async fn protocol_interrupt_preserves_runtime_and_followup_delivery() {
        protocol_interrupt(false, false).await;
    }

    #[tokio::test]
    async fn protocol_interrupt_accepts_result_before_ack() {
        protocol_interrupt(true, false).await;
    }

    #[tokio::test]
    async fn protocol_interrupt_surfaces_rejection() {
        protocol_interrupt(false, true).await;
    }
}
