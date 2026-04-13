use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};

use super::events::{init_event, permission_request_event, question_request_event};
use super::stream_state::LoopState;
use super::PendingRequestKind;
use crate::domain::agents::adapter::{RuntimeError, RuntimeEvent};

pub(super) fn spawn_event_loop(
    mut source_rx: mpsc::Receiver<opencode_sdk_rs::SseEvent>,
    tx: mpsc::Sender<Result<RuntimeEvent, RuntimeError>>,
    pending_requests: Arc<Mutex<HashMap<String, PendingRequestKind>>>,
    session_id: String,
    model: Option<String>,
) {
    tokio::spawn(async move {
        let mut state = LoopState::new(session_id.clone(), model);
        while let Some(event) = source_rx.recv().await {
            let mut output = Vec::new();
            match event {
                opencode_sdk_rs::SseEvent::ServerConnected => {
                    output.push(init_event(&session_id, state.current_model()));
                }
                opencode_sdk_rs::SseEvent::MessageCreated(message)
                | opencode_sdk_rs::SseEvent::MessageUpdated(message) => {
                    state.on_message(message, &mut output);
                }
                opencode_sdk_rs::SseEvent::PartCreated {
                    session_id,
                    message_id,
                    part,
                } => {
                    state.on_part(&session_id, &message_id, &part, &mut output);
                }
                opencode_sdk_rs::SseEvent::PartUpdated {
                    session_id,
                    message_id,
                    part,
                } => {
                    if matches!(part, opencode_sdk_rs::MessagePart::ToolUse { .. }) {
                        state.on_part(&session_id, &message_id, &part, &mut output);
                    }
                }
                opencode_sdk_rs::SseEvent::PartDelta {
                    session_id,
                    message_id,
                    part_id,
                    field,
                    delta,
                } => {
                    state.on_delta(
                        &session_id,
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
                    pending_requests
                        .lock()
                        .await
                        .insert(request.id.clone(), PendingRequestKind::Permission);
                    output.push(permission_request_event(&request));
                }
                opencode_sdk_rs::SseEvent::QuestionCreated(question) => {
                    pending_requests
                        .lock()
                        .await
                        .insert(question.id.clone(), PendingRequestKind::Question);
                    output.push(question_request_event(&question));
                }
                _ => {}
            }

            for mapped in output {
                if tx.send(Ok(mapped)).await.is_err() {
                    return;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::spawn_event_loop;
    use crate::domain::agents::adapter::{RuntimeContentDelta, RuntimeStreamEvent, RuntimeUsage};
    use crate::domain::agents::opencode::PendingRequestKind;
    use std::collections::HashMap;
    use std::sync::Arc;
    use tokio::sync::{mpsc, Mutex};

    async fn collect_events(
        source_events: Vec<opencode_sdk_rs::SseEvent>,
    ) -> Vec<crate::domain::agents::adapter::RuntimeEvent> {
        let (source_tx, source_rx) = mpsc::channel(16);
        let (tx, mut rx) = mpsc::channel(32);

        spawn_event_loop(
            source_rx,
            tx,
            Arc::new(Mutex::new(HashMap::<String, PendingRequestKind>::new())),
            "ses_root".to_string(),
            Some("openai/gpt-5.4".to_string()),
        );

        for event in source_events {
            source_tx.send(event).await.expect("send source event");
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

    fn assistant_message_with_parts(
        id: &str,
        parts: Vec<opencode_sdk_rs::MessagePart>,
    ) -> opencode_sdk_rs::Message {
        opencode_sdk_rs::Message {
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
    async fn part_updated_for_non_tool_use_is_ignored() {
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

        assert_eq!(events.len(), 1);
        assert!(matches!(
            events[0].stream_event(),
            Some(RuntimeStreamEvent::MessageStart { .. })
        ));
    }

    #[tokio::test]
    async fn finishes_turn_only_after_assistant_activity() {
        let events = collect_events(vec![session_updated(opencode_sdk_rs::SessionStatus::Completed)]).await;

        assert!(events.is_empty());
    }

    #[tokio::test]
    async fn finished_assistant_message_does_not_end_turn_without_session_completion() {
        let events = collect_events(vec![opencode_sdk_rs::SseEvent::MessageCreated(
            assistant_message_with_parts(
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
    async fn session_completed_emits_result_after_assistant_activity() {
        let events = collect_events(vec![
            opencode_sdk_rs::SseEvent::MessageCreated(assistant_message("msg_1")),
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
        assert!(events.iter().any(|event| matches!(
            event.stream_event(),
            Some(RuntimeStreamEvent::ContentBlockStop { .. })
        )));
        assert!(events.last().is_some_and(|event| event.is_result()));
    }

    #[tokio::test]
    async fn repeated_assistant_message_carries_final_usage_on_result() {
        let events = collect_events(vec![
            opencode_sdk_rs::SseEvent::MessageCreated(assistant_message_with_parts(
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

        let result = events.last().expect("result event");
        assert!(result.is_result());
        let result_usage = result.usage().expect("result usage");
        assert_eq!(result_usage.input_tokens, usage(12, 4, 1, 9).input_tokens);
        assert_eq!(result_usage.output_tokens, usage(12, 4, 1, 9).output_tokens);
    }

}
