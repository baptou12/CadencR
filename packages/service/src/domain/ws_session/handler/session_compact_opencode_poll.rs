use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use super::WsSender;

const COMPACT_POLL_INTERVAL: Duration = Duration::from_millis(250);
const COMPACT_POLL_MAX_INTERVAL: Duration = Duration::from_secs(2);
const COMPACT_POLL_TIMEOUT: Duration = Duration::from_secs(120);

pub(super) async fn await_compaction_messages(
    sender: &WsSender,
    client: &opencode_sdk_rs::OpenCodeClient,
    runtime_session_id: &str,
    existing_ids: &HashSet<String>,
    cancel: &AtomicBool,
) -> Result<Vec<opencode_sdk_rs::Message>, String> {
    await_compaction_messages_with(
        sender,
        existing_ids,
        cancel,
        COMPACT_POLL_TIMEOUT,
        COMPACT_POLL_INTERVAL,
        || async {
            client
                .list_messages(runtime_session_id)
                .await
                .map_err(|error| format!("Failed to load summarized messages: {error}"))
        },
    )
    .await
}

async fn await_compaction_messages_with<F, Fut>(
    sender: &WsSender,
    existing_ids: &HashSet<String>,
    cancel: &AtomicBool,
    poll_timeout: Duration,
    initial_poll_interval: Duration,
    mut list_messages: F,
) -> Result<Vec<opencode_sdk_rs::Message>, String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<Vec<opencode_sdk_rs::Message>, String>>,
{
    let started = Instant::now();
    let mut poll_interval = initial_poll_interval;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("OpenCode compaction was interrupted".to_string());
        }
        if sender.is_closed() {
            return Err("OpenCode compaction cancelled because the websocket closed".to_string());
        }
        let messages = list_messages().await?;
        let mut has_compaction_part = false;
        let mut has_summary_candidate = false;
        for message in messages
            .iter()
            .filter(|message| !existing_ids.contains(&message.id))
        {
            has_compaction_part |= message_has_compaction_part(message);
            has_summary_candidate |= summary_message_candidate(message);
            if has_compaction_part && has_summary_candidate {
                return Ok(messages
                    .into_iter()
                    .filter(|message| !existing_ids.contains(&message.id))
                    .collect());
            }
        }
        if started.elapsed() >= poll_timeout {
            return Err("OpenCode did not return a compaction summary in time".to_string());
        }
        tokio::time::sleep(poll_interval).await;
        poll_interval = (poll_interval + COMPACT_POLL_INTERVAL).min(COMPACT_POLL_MAX_INTERVAL);
    }
}

pub(super) fn summary_message_candidate(message: &opencode_sdk_rs::Message) -> bool {
    matches!(message.role, opencode_sdk_rs::MessageRole::Assistant)
        && message.parts.iter().any(|part| {
            matches!(
                part,
                opencode_sdk_rs::MessagePart::Text { .. }
                    | opencode_sdk_rs::MessagePart::Thinking { .. }
            )
        })
}

fn message_has_compaction_part(message: &opencode_sdk_rs::Message) -> bool {
    message.parts.iter().any(|part| {
        matches!(
            part,
            opencode_sdk_rs::MessagePart::Other(raw)
                if raw.get("type").and_then(serde_json::Value::as_str) == Some("compaction")
        )
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::sync::atomic::AtomicBool;
    use std::time::Duration;

    use tokio::sync::mpsc;

    use super::await_compaction_messages_with;

    #[tokio::test]
    async fn await_compaction_messages_times_out_without_summary() {
        let (sender, _rx) = mpsc::unbounded_channel();
        let cancel = AtomicBool::new(false);
        let error = await_compaction_messages_with(
            &sender,
            &HashSet::new(),
            &cancel,
            Duration::from_millis(0),
            Duration::from_millis(0),
            || async { Ok(Vec::new()) },
        )
        .await
        .expect_err("missing summary should time out");
        assert!(error.contains("in time"));
    }

    #[tokio::test]
    async fn await_compaction_messages_honors_cancel_flag() {
        let (sender, _rx) = mpsc::unbounded_channel();
        let cancel = AtomicBool::new(true);
        let error = await_compaction_messages_with(
            &sender,
            &HashSet::new(),
            &cancel,
            Duration::from_secs(1),
            Duration::from_millis(0),
            || async { Ok(Vec::new()) },
        )
        .await
        .expect_err("cancelled compact should fail");
        assert!(error.contains("interrupted"));
    }
}
