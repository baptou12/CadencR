use std::collections::HashMap;
use std::sync::Arc;

use opencode_sdk_rs::DispatcherStatus;
use tokio::sync::{broadcast, mpsc, Mutex};
use tracing::{warn, Instrument};

use super::events::{init_event, permission_request_event, question_request_event};
use super::session::PendingRequestKind;
use super::stream_state::LoopState;
use super::stream_supervisor::{forward_status, recv_status};
use crate::domain::agents::adapter::{RuntimeError, RuntimeEvent, RuntimeStreamStatus};

/// Spawn the per-session OpenCode event loop.
///
/// When `dispatcher` and `status_rx` are both `Some`, the loop is in
/// "resilient mode": on `source_rx` EOF (which the dispatcher triggers on
/// every reconnect) it transparently resubscribes instead of terminating,
/// and it forwards `DispatcherStatus` events to the WS bridge as
/// `RuntimeStreamStatus` so the UI can show a reconnecting banner.
///
/// When both are `None` (test mode), the loop terminates on `source_rx`
/// EOF with the existing `"SSE source closed unexpectedly"` error so unit
/// tests can drive shutdown by dropping the source sender.
#[allow(clippy::too_many_arguments)]
pub(super) fn spawn_event_loop(
    mut source_rx: mpsc::UnboundedReceiver<opencode_sdk_rs::SseEvent>,
    tx: mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    pending_requests: Arc<Mutex<HashMap<String, PendingRequestKind>>>,
    session_id: String,
    model: Option<String>,
    context_window: Option<u64>,
    expected_mcp_servers: Vec<String>,
    dispatcher: Option<Arc<opencode_sdk_rs::SseDispatcher>>,
    mut status_rx: Option<broadcast::Receiver<DispatcherStatus>>,
) {
    let span = tracing::info_span!("opencode_event_loop", session_id = %session_id);
    tokio::spawn(
        async move {
            let mut state = LoopState::new(session_id.clone(), model);
            let mut was_degraded = false;
            let mut had_initial_connect = false;

            loop {
                // tokio::select! handles three sources: lifecycle events,
                // SSE events, and an empty branch when status_rx is None.
                // We can't conditionally include arms, so use a small
                // helper to await Option<broadcast::Receiver> as never
                // when None.
                tokio::select! {
                    biased;

                    // 1. Dispatcher lifecycle. Surfaced before SSE events
                    //    so banner state changes are not blocked by a
                    //    backlog of live events.
                    status = recv_status(status_rx.as_mut()), if status_rx.is_some() => {
                        match status {
                            Ok(status) => {
                                if !forward_status(
                                    &tx,
                                    status,
                                    &mut was_degraded,
                                    &mut had_initial_connect,
                                ).await {
                                    return;
                                }
                            }
                            Err(broadcast::error::RecvError::Lagged(skipped)) => {
                                warn!(
                                    session_id,
                                    skipped,
                                    "opencode lifecycle bus lagged; treating as degraded"
                                );
                                if !was_degraded {
                                    was_degraded = true;
                                    let degraded = RuntimeEvent::stream_status_event(
                                        RuntimeStreamStatus::Degraded {
                                            reason: format!("status_lag:{skipped}"),
                                        },
                                    );
                                    if tx.send(Ok(degraded)).await.is_err() {
                                        return;
                                    }
                                }
                            }
                            Err(broadcast::error::RecvError::Closed) => {
                                warn!(
                                    session_id,
                                    "opencode lifecycle bus closed; downgrading to non-resilient mode"
                                );
                                status_rx = None;
                            }
                        }
                    }

                    // 2. Live SSE events for this session.
                    msg = source_rx.recv() => {
                        match msg {
                            Some(event) => {
                                if !handle_event(
                                    event,
                                    &mut state,
                                    &tx,
                                    &pending_requests,
                                    &session_id,
                                    context_window,
                                    &expected_mcp_servers,
                                ).await {
                                    return;
                                }
                            }
                            None => {
                                // SSE source closed. In resilient mode,
                                // resubscribe instead of terminating; the
                                // dispatcher dropped us as part of its
                                // reconnect cycle (see SDK plan finding 1).
                                if let Some(dispatcher) = dispatcher.as_ref() {
                                    source_rx = dispatcher.subscribe(&session_id).await;
                                    continue;
                                }
                                // Non-resilient mode (tests): preserve the
                                // pre-PR-A contract — flush pending state
                                // and signal a hard close.
                                let mut final_output = Vec::new();
                                state.force_flush_pending(&mut final_output);
                                for mapped in final_output {
                                    if tx.send(Ok(mapped)).await.is_err() {
                                        break;
                                    }
                                }
                                let _ = tx
                                    .send(Err(RuntimeError::new("SSE source closed unexpectedly")))
                                    .await;
                                return;
                            }
                        }
                    }
                }
            }
        }
        .instrument(span),
    );
}

/// Process one SseEvent, push any derived `RuntimeEvent`s to the WS
/// bridge, and return false if the bridge is gone.
async fn handle_event(
    event: opencode_sdk_rs::SseEvent,
    state: &mut LoopState,
    tx: &mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    pending_requests: &Arc<Mutex<HashMap<String, PendingRequestKind>>>,
    session_id: &str,
    context_window: Option<u64>,
    expected_mcp_servers: &[String],
) -> bool {
    let mut output = Vec::new();
    match event {
        opencode_sdk_rs::SseEvent::ServerConnected => {
            output.push(init_event(
                session_id,
                state.current_model(),
                context_window,
                expected_mcp_servers,
            ));
        }
        opencode_sdk_rs::SseEvent::MessageCreated(message)
        | opencode_sdk_rs::SseEvent::MessageUpdated(message) => {
            state.on_message(message, &mut output);
        }
        opencode_sdk_rs::SseEvent::PartCreated {
            session_id: ev_session_id,
            message_id,
            part,
        }
        | opencode_sdk_rs::SseEvent::PartUpdated {
            session_id: ev_session_id,
            message_id,
            part,
        } => {
            state.on_part(&ev_session_id, &message_id, &part, &mut output);
        }
        opencode_sdk_rs::SseEvent::PartDelta {
            session_id: ev_session_id,
            message_id,
            part_id,
            field,
            delta,
        } => {
            state.on_delta(
                &ev_session_id,
                &message_id,
                &part_id,
                &field,
                &delta,
                &mut output,
            );
        }
        opencode_sdk_rs::SseEvent::SessionCreated(session)
        | opencode_sdk_rs::SseEvent::SessionUpdated(session) => {
            state.on_session_updated(session, &mut output);
        }
        opencode_sdk_rs::SseEvent::PermissionCreated(request) => {
            state.note_permission_request(&request);
            pending_requests
                .lock()
                .await
                .insert(request.id.clone(), PendingRequestKind::Permission);
            output.push(permission_request_event(&request));
        }
        opencode_sdk_rs::SseEvent::PermissionUpdated { id, status } => {
            state.resolve_permission_update(&id, &status, &mut output);
        }
        opencode_sdk_rs::SseEvent::QuestionCreated(question) => {
            pending_requests
                .lock()
                .await
                .insert(question.id.clone(), PendingRequestKind::Question);
            output.push(question_request_event(&question));
        }
        // Replaces the old silent `_ => {}`. Matches finding 6 layer 2:
        // unhandled variants now show up in tracing instead of vanishing.
        other => {
            warn!(
                session_id,
                event = ?other,
                "opencode event_loop: unhandled SseEvent variant"
            );
        }
    }

    for mapped in output {
        if tx.send(Ok(mapped)).await.is_err() {
            warn!(
                session_id,
                "Event loop: downstream receiver dropped, stopping"
            );
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::spawn_event_loop;
    use crate::domain::agents::adapter::{RuntimeContentDelta, RuntimeStreamEvent, RuntimeUsage};
    use crate::domain::agents::opencode::session::PendingRequestKind;
    use std::collections::HashMap;
    use std::sync::Arc;
    use tokio::sync::{mpsc, Mutex};

    async fn collect_events(
        source_events: Vec<opencode_sdk_rs::SseEvent>,
    ) -> Vec<crate::domain::agents::adapter::RuntimeEvent> {
        let (source_tx, source_rx) = mpsc::unbounded_channel();
        let (tx, mut rx) = mpsc::channel(32);

        // Tests use non-resilient mode (no dispatcher, no status_rx) so
        // dropping `source_tx` cleanly terminates the loop. This preserves
        // the pre-PR-A test contract; production wires Some/Some.
        spawn_event_loop(
            source_rx,
            tx,
            Arc::new(Mutex::new(HashMap::<String, PendingRequestKind>::new())),
            "ses_root".to_string(),
            Some("openai/gpt-5.4".to_string()),
            None,
            Vec::new(),
            None,
            None,
        );

        for event in source_events {
            source_tx.send(event).expect("send source event");
        }
        drop(source_tx);

        let mut output = Vec::new();
        while let Some(Ok(event)) = rx.recv().await {
            output.push(event);
        }
        output
    }

    fn assistant_message(id: &str) -> opencode_sdk_rs::Message {
        opencode_sdk_rs::Message {
            id: id.to_string(),
            session_id: "ses_root".to_string(),
            role: opencode_sdk_rs::MessageRole::Assistant,
            parts: Vec::new(),
            created_at: None,
            model: Some("openai/gpt-5.4".to_string()),
            tokens: None,
            finished: true,
        }
    }

    fn assistant_message_with_parts_unfinished(
        id: &str,
        parts: Vec<opencode_sdk_rs::MessagePart>,
    ) -> opencode_sdk_rs::Message {
        opencode_sdk_rs::Message {
            finished: false,
            parts,
            ..assistant_message(id)
        }
    }

    fn assistant_message_with_tokens(
        id: &str,
        tokens: opencode_sdk_rs::TokenUsage,
    ) -> opencode_sdk_rs::Message {
        opencode_sdk_rs::Message {
            tokens: Some(tokens),
            ..assistant_message(id)
        }
    }

    fn session_updated(status: opencode_sdk_rs::SessionStatus) -> opencode_sdk_rs::SseEvent {
        opencode_sdk_rs::SseEvent::SessionUpdated(opencode_sdk_rs::Session {
            id: "ses_root".to_string(),
            title: None,
            directory: "/tmp".to_string(),
            status,
            parent_id: None,
            created_at: None,
            updated_at: None,
        })
    }

    fn usage(input: u64, cache_read: u64, cache_write: u64, output: u64) -> RuntimeUsage {
        RuntimeUsage {
            input_tokens: input + cache_read + cache_write,
            output_tokens: output,
        }
    }

    fn opencode_tokens(
        input: u64,
        cache_read: u64,
        cache_write: u64,
        output: u64,
    ) -> opencode_sdk_rs::TokenUsage {
        opencode_sdk_rs::TokenUsage {
            total: None,
            input,
            output,
            reasoning: 0,
            cache: opencode_sdk_rs::TokenCacheUsage {
                read: cache_read,
                write: cache_write,
            },
        }
    }

    #[tokio::test]
    async fn part_updated_for_tool_use_is_forwarded() {
        let events = collect_events(vec![
            opencode_sdk_rs::SseEvent::MessageCreated(assistant_message("msg_1")),
            opencode_sdk_rs::SseEvent::PartUpdated {
                session_id: "ses_root".to_string(),
                message_id: "msg_1".to_string(),
                part: opencode_sdk_rs::MessagePart::ToolUse {
                    id: "tool_1".to_string(),
                    tool_id: "call_1".to_string(),
                    name: "Read".to_string(),
                    input: serde_json::json!({ "file_path": "src/main.rs" }),
                },
            },
        ])
        .await;

        assert_eq!(events.len(), 3);
        assert!(matches!(
            events[1].stream_event(),
            Some(RuntimeStreamEvent::ContentBlockStart { .. })
        ));
        assert!(matches!(
            events[2].stream_event(),
            Some(RuntimeStreamEvent::ContentBlockDelta { .. })
        ));
    }

    #[tokio::test]
    async fn part_updated_for_non_tool_use_is_forwarded() {
        let events = collect_events(vec![
            opencode_sdk_rs::SseEvent::MessageCreated(assistant_message("msg_1")),
            opencode_sdk_rs::SseEvent::PartUpdated {
                session_id: "ses_root".to_string(),
                message_id: "msg_1".to_string(),
                part: opencode_sdk_rs::MessagePart::Text {
                    id: "text_1".to_string(),
                    text: "hello".to_string(),
                },
            },
        ])
        .await;

        assert_eq!(events.len(), 3);
        assert!(matches!(
            events[0].stream_event(),
            Some(RuntimeStreamEvent::MessageStart { .. })
        ));
        assert!(matches!(
            events[1].stream_event(),
            Some(RuntimeStreamEvent::ContentBlockStart { .. })
        ));
        assert!(matches!(
            events[2].stream_event(),
            Some(RuntimeStreamEvent::ContentBlockDelta { .. })
        ));
    }

    #[tokio::test]
    async fn finishes_turn_only_after_assistant_activity() {
        let events = collect_events(vec![session_updated(
            opencode_sdk_rs::SessionStatus::Completed,
        )])
        .await;

        assert!(events.is_empty());
    }

    #[tokio::test]
    async fn finished_assistant_message_does_not_end_turn_without_session_completion() {
        let events = collect_events(vec![opencode_sdk_rs::SseEvent::MessageCreated(
            assistant_message_with_parts_unfinished(
                "msg_1",
                vec![opencode_sdk_rs::MessagePart::Text {
                    id: "text_1".to_string(),
                    text: "hello".to_string(),
                }],
            ),
        )])
        .await;

        assert_eq!(events.len(), 2);
        assert!(matches!(
            events[0].stream_event(),
            Some(RuntimeStreamEvent::MessageStart { .. })
        ));
        assert!(events[1].assistant_message().is_some());
        assert!(!events.iter().any(|event| event.is_result()));
    }

    #[tokio::test]
    async fn assistant_message_emits_usage_from_opencode_tokens() {
        let events = collect_events(vec![opencode_sdk_rs::SseEvent::MessageCreated(
            assistant_message_with_tokens("msg_1", opencode_tokens(10, 2, 3, 7)),
        )])
        .await;

        assert_eq!(events.len(), 1);
        assert!(matches!(
            events[0].stream_event(),
            Some(RuntimeStreamEvent::MessageStart { .. })
        ));
        let event_usage = events[0].usage().expect("message_start usage");
        assert_eq!(event_usage.input_tokens, usage(10, 2, 3, 7).input_tokens);
        assert_eq!(event_usage.output_tokens, usage(10, 2, 3, 7).output_tokens);
    }

    #[tokio::test]
    async fn session_completed_without_terminal_message_does_not_emit_result() {
        let events = collect_events(vec![
            opencode_sdk_rs::SseEvent::MessageCreated(assistant_message_with_parts_unfinished(
                "msg_1",
                Vec::new(),
            )),
            opencode_sdk_rs::SseEvent::PartCreated {
                session_id: "ses_root".to_string(),
                message_id: "msg_1".to_string(),
                part: opencode_sdk_rs::MessagePart::Text {
                    id: "text_1".to_string(),
                    text: "hello".to_string(),
                },
            },
            opencode_sdk_rs::SseEvent::PartDelta {
                session_id: "ses_root".to_string(),
                message_id: "msg_1".to_string(),
                part_id: "text_1".to_string(),
                field: "text".to_string(),
                delta: " there".to_string(),
            },
            session_updated(opencode_sdk_rs::SessionStatus::Completed),
        ])
        .await;

        assert!(matches!(
            events.first().and_then(|event| event.stream_event()),
            Some(RuntimeStreamEvent::MessageStart { .. })
        ));
        assert!(events.iter().any(|event| matches!(
            event.stream_event(),
            Some(RuntimeStreamEvent::ContentBlockStart { .. })
        )));
        assert!(events.iter().any(|event| matches!(
            event.stream_event(),
            Some(RuntimeStreamEvent::ContentBlockDelta {
                delta: RuntimeContentDelta::Text { .. },
                ..
            })
        )));
        assert!(!events.iter().any(|event| event.is_result()));
    }

    #[tokio::test]
    async fn repeated_assistant_message_carries_final_usage_on_result() {
        let events = collect_events(vec![
            opencode_sdk_rs::SseEvent::MessageCreated(assistant_message_with_parts_unfinished(
                "msg_1",
                vec![opencode_sdk_rs::MessagePart::Text {
                    id: "text_1".to_string(),
                    text: "draft".to_string(),
                }],
            )),
            opencode_sdk_rs::SseEvent::MessageUpdated(assistant_message_with_tokens(
                "msg_1",
                opencode_tokens(12, 4, 1, 9),
            )),
            session_updated(opencode_sdk_rs::SessionStatus::Idle),
        ])
        .await;

        let result = events
            .iter()
            .rev()
            .find(|event| event.is_result())
            .expect("result event");
        assert!(result.is_result());
        let result_usage = result.usage().expect("result usage");
        assert_eq!(result_usage.input_tokens, usage(12, 4, 1, 9).input_tokens);
        assert_eq!(result_usage.output_tokens, usage(12, 4, 1, 9).output_tokens);
    }

    /// Verifies the `select!` plumbing: spawn_event_loop subscribes to
    /// `status_rx` and routes Failed through to a terminal error. The
    /// fine-grained mapping for every other DispatcherStatus variant is
    /// covered in `stream_supervisor::tests` so we don't repeat it here.
    #[tokio::test]
    async fn lifecycle_failed_terminates_loop_with_error() {
        use opencode_sdk_rs::DispatcherStatus;
        use tokio::sync::broadcast;

        let (_source_tx, source_rx) = mpsc::unbounded_channel();
        let (tx, mut rx) = mpsc::channel(4);
        let (status_tx, status_rx) = broadcast::channel(4);

        spawn_event_loop(
            source_rx,
            tx,
            Arc::new(Mutex::new(HashMap::<String, PendingRequestKind>::new())),
            "ses_root".to_string(),
            None,
            None,
            Vec::new(),
            None,
            Some(status_rx),
        );

        let _ = status_tx.send(DispatcherStatus::Failed {
            error: "permanent".to_string(),
        });

        let mut hard_error: Option<String> = None;
        while let Some(msg) = rx.recv().await {
            if let Err(err) = msg {
                hard_error = Some(err.to_string());
                break;
            }
        }
        assert!(
            hard_error
                .as_deref()
                .map(|err| err.contains("OpenCode stream failed"))
                .unwrap_or(false),
            "expected hard error after Failed, got {hard_error:?}"
        );
    }
}
