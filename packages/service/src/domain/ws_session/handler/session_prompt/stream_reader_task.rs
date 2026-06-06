use axum::extract::ws::Message;
use tokio::time::Instant;
use tracing::{debug, info};

use crate::domain::agents::adapter::{RuntimeError, RuntimeEvent, RuntimeMessageRx};
use crate::domain::agents::{runtime_adapter, runtime_session_finished};
use crate::domain::runtime_stream::RuntimeUsageState;
use crate::domain::session_status::{AgentStatus, SessionStatusBroadcaster};
use crate::domain::ws_session::persistence::WsSessionPersistence;
use crate::domain::ws_session::protocol::{SessionEndedPayload, WsEnvelope};
use crate::domain::ws_session::sender_registry::WsFeatureSenderRegistry;

use super::super::{SdkSessions, WsSender};
use super::stream_reader_resume::transition_active_to_pending_on_stream_end;

pub(super) struct StreamReaderTask {
    pub db_session_id: i64,
    pub feature_id: i64,
    pub message_rx: RuntimeMessageRx,
    pub sender: WsSender,
    /// Other devices viewing the same feature; every owner-bound stream message
    /// is mirrored to them via [`StreamReaderTask::send_and_mirror`].
    pub feature_senders: WsFeatureSenderRegistry,
    pub write_pool: sqlx::SqlitePool,
    pub session_status_tx: SessionStatusBroadcaster,
    pub sdk_sessions: SdkSessions,
    pub runtime_provider: String,
    pub provider_context_window: Option<u64>,
}

pub(super) struct StreamReaderState {
    pub(super) needs_session_id_capture: bool,
    pub(super) runtime_session_id: Option<String>,
    pub(super) usage_state: RuntimeUsageState,
    pub(super) last_runtime_activity: Instant,
    pub(super) last_provider_reconcile: Instant,
    pub(super) last_signal_status: Option<AgentStatus>,
    pub(super) between_turns: bool,
}

enum ReaderAction {
    Continue,
    Break,
    Event(RuntimeEvent),
    Error(RuntimeError),
    Closed,
}

pub(super) enum EventOutcome {
    Continue,
    Break,
}

impl StreamReaderState {
    fn new(initial_context_window: Option<u64>) -> Self {
        Self {
            needs_session_id_capture: true,
            runtime_session_id: None,
            usage_state: RuntimeUsageState::new(initial_context_window),
            last_runtime_activity: Instant::now(),
            last_provider_reconcile: Instant::now(),
            last_signal_status: None,
            between_turns: true,
        }
    }
}

impl StreamReaderTask {
    /// Send `msg` to this turn's owner socket and mirror it to any *other*
    /// devices viewing the same feature. Others are mirrored first so the owner
    /// send can move `msg` without a clone; in the common single-viewer case
    /// `broadcast_others` is a no-op. Returns `true` when the owner socket is
    /// gone, so callers can stop the loop exactly as a bare `send().is_err()`.
    pub(super) async fn send_and_mirror(&self, msg: Message) -> bool {
        self.feature_senders
            .send_and_mirror(self.feature_id, &self.sender, msg)
            .await
    }

    pub async fn run(mut self) {
        info!(self.db_session_id, "stream reader started");
        let initial_context_window = self.initial_context_window().await;
        let runtime_adapter = runtime_adapter(&self.runtime_provider);
        let mut persistence = WsSessionPersistence::with_session_id(
            self.write_pool.clone(),
            self.feature_id,
            Some(self.db_session_id),
        );
        let mut state = StreamReaderState::new(initial_context_window);

        loop {
            match self.next_action(&mut state).await {
                ReaderAction::Continue => continue,
                ReaderAction::Break => break,
                ReaderAction::Closed => {
                    self.send_stream_closed().await;
                    break;
                }
                ReaderAction::Error(error) => {
                    self.handle_stream_error(error).await;
                    break;
                }
                ReaderAction::Event(runtime_event) => {
                    if let EventOutcome::Break = self
                        .handle_runtime_event(
                            &mut state,
                            runtime_adapter,
                            &mut persistence,
                            runtime_event,
                        )
                        .await
                    {
                        break;
                    }
                }
            }
        }

        transition_active_to_pending_on_stream_end(&self.sdk_sessions, self.db_session_id).await;
    }

    async fn initial_context_window(&self) -> Option<u64> {
        match self.provider_context_window {
            Some(cw) if cw > 0 => Some(cw),
            _ => WsSessionPersistence::get_session_row(&self.write_pool, self.db_session_id)
                .await
                .and_then(|row| row.context_window)
                .and_then(|cw| u64::try_from(cw).ok())
                .filter(|cw| *cw > 0),
        }
    }

    async fn next_action(&mut self, state: &mut StreamReaderState) -> ReaderAction {
        let recv_result = tokio::time::timeout(
            std::time::Duration::from_millis(500),
            self.message_rx.recv(),
        )
        .await;

        match recv_result {
            Ok(Some(Ok(runtime_event))) => ReaderAction::Event(runtime_event),
            Ok(Some(Err(error))) => ReaderAction::Error(error),
            Ok(None) => ReaderAction::Closed,
            Err(_) => self.handle_timeout_tick(state).await,
        }
    }

    async fn handle_timeout_tick(&self, state: &mut StreamReaderState) -> ReaderAction {
        if self.sender.send(Message::Ping(vec![].into())).is_err() {
            debug!(
                self.db_session_id,
                "WebSocket closed during timeout check, stopping stream reader"
            );
            return ReaderAction::Break;
        }
        if !should_reconcile_provider(state) {
            return ReaderAction::Continue;
        }
        state.last_provider_reconcile = Instant::now();
        let Some(runtime_sid) = state.runtime_session_id.as_deref() else {
            return ReaderAction::Continue;
        };
        if runtime_session_finished(&self.runtime_provider, runtime_sid).await {
            self.reconcile_provider_completion(runtime_sid).await;
            return ReaderAction::Break;
        }
        ReaderAction::Continue
    }

    async fn reconcile_provider_completion(&self, runtime_sid: &str) {
        info!(
            self.db_session_id,
            runtime_session_id = runtime_sid,
            "provider reports finished session; reconciling completion"
        );
        WsSessionPersistence::mark_completed_static(&self.write_pool, self.db_session_id).await;
        WsSessionPersistence::broadcast_session_status(
            &self.session_status_tx,
            self.db_session_id,
            self.feature_id,
            AgentStatus::Idle,
            None,
        );
        let end_env = WsEnvelope::new(
            "session",
            "ended",
            serde_json::to_value(SessionEndedPayload {
                reason: "provider_complete".into(),
            })
            .unwrap(),
        );
        let _ = self
            .send_and_mirror(Message::Text(String::from(end_env).into()))
            .await;
    }
}

fn should_reconcile_provider(state: &StreamReaderState) -> bool {
    state.last_runtime_activity.elapsed() >= std::time::Duration::from_millis(750)
        && state.last_provider_reconcile.elapsed() >= std::time::Duration::from_millis(750)
}
