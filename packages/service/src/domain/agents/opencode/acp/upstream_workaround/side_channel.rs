use super::root_usage_listener::{self, RootUsageState};
use super::subagent_listener::{self, ListenerState, PendingSubagentTasks};
use crate::domain::agents::adapter::{RuntimeError, RuntimeEvent};
use opencode_sdk_rs::OpenCodeClient;
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

const POLL_INTERVAL: Duration = Duration::from_millis(500);
const IDLE_INTERVAL: Duration = Duration::from_secs(2);
const ACTIVE_USAGE_POLLS: u8 = 4;

pub(in crate::domain::agents::opencode::acp) fn spawn_side_channel_listeners(
    opencode_http_port: u16,
    cwd: PathBuf,
    root_session_id: String,
    context_window: Option<u64>,
    pending_tasks: PendingSubagentTasks,
    runtime_tx: mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
) -> JoinHandle<()> {
    tracing::info!(
        port = opencode_http_port,
        cwd = %cwd.display(),
        root_session_id = %root_session_id,
        "OpenCode side channel: spawning HTTP polling task"
    );
    tokio::spawn(async move {
        let client = OpenCodeClient::new(opencode_http_port);
        let directory = cwd.to_string_lossy().to_string();
        let mut usage_state = RootUsageState::default();
        let mut subagent_state = ListenerState::new(root_session_id.clone());
        let mut active_usage_polls = ACTIVE_USAGE_POLLS;
        loop {
            let poll_usage = active_usage_polls > 0;
            if poll_usage {
                match root_usage_listener::poll_once(
                    &client,
                    &root_session_id,
                    context_window,
                    &mut usage_state,
                    &runtime_tx,
                )
                .await
                {
                    Ok(true) => active_usage_polls = ACTIVE_USAGE_POLLS,
                    Ok(false) => active_usage_polls = active_usage_polls.saturating_sub(1),
                    Err(()) => return,
                }
            }
            let subagent_active = pending_tasks
                .lock()
                .ok()
                .map(|queue| !queue.is_empty())
                .unwrap_or(false)
                || !subagent_state.is_empty();
            if subagent_active
                && subagent_listener::poll_once(
                    &client,
                    &directory,
                    &root_session_id,
                    &mut subagent_state,
                    &pending_tasks,
                    &runtime_tx,
                )
                .await
                .is_err()
            {
                return;
            }
            let interval = if poll_usage || subagent_active {
                POLL_INTERVAL
            } else {
                active_usage_polls = ACTIVE_USAGE_POLLS;
                IDLE_INTERVAL
            };
            tokio::time::sleep(interval).await;
        }
    })
}
