use std::path::PathBuf;

use axum::extract::ws::Message;
use regex_lite::Regex;
use sqlx::SqlitePool;
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use claude_agent_sdk_rs::{
    ContentBlock, ContentDelta, Options, PermissionMode, SdkMessage, StreamEventData,
};

use super::protocol::{FeatureRenamedPayload, WsEnvelope};

const AUTO_NAME_SYSTEM_PROMPT: &str = "You are a feature naming assistant. Your ONLY job is to output a short name (3-7 words) for a coding session. ALWAYS output a name, even if the input is vague — just pick a reasonable generic name. Examples: 'hi' → 'General Coding Session', 'fix the login bug' → 'Fix Login Bug', 'I want to add dark mode' → 'Add Dark Mode Support'.";

const AUTO_NAME_MODEL: &str = "claude-haiku-4-5-20251001";

/// Check if a feature still has its default auto-generated title (e.g. "Session 3" or "Untitled Feature").
pub async fn has_default_title(pool: &SqlitePool, feature_id: i64) -> bool {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT title FROM features WHERE id = ?")
            .bind(feature_id)
            .fetch_optional(pool)
            .await
            .unwrap_or(None);

    match row {
        Some((title,)) => {
            let re = Regex::new(r"(?i)^Session \d+$").unwrap();
            re.is_match(&title) || title == "Untitled Feature"
        }
        None => false,
    }
}

/// Auto-name a feature using a lightweight Haiku query.
///
/// Returns the generated name, or None on failure.
pub async fn auto_name_feature(
    pool: SqlitePool,
    feature_id: i64,
    user_input: String,
    cwd: String,
    cli_path: Option<PathBuf>,
    ws_sender: mpsc::UnboundedSender<Message>,
) -> Option<String> {
    let escaped_input = user_input.replace('"', "\\\"");
    let prompt = format!(
        "Now name this session. User's first message: \"{escaped_input}\". Reply with ONLY: __FEATURE_NAME_START__<name>__FEATURE_NAME_END__"
    );

    let options = Options {
        cwd: PathBuf::from(&cwd),
        permission_mode: Some(PermissionMode::AcceptEdits),
        path_to_cli: cli_path,
        model: Some(AUTO_NAME_MODEL.to_string()),
        system_prompt: Some(AUTO_NAME_SYSTEM_PROMPT.to_string()),
        allowed_tools: Some(vec![]),
        ..Options::default()
    };

    let mut query = match claude_agent_sdk_rs::query(&prompt, options).await {
        Ok(q) => q,
        Err(e) => {
            error!(feature_id, error = %e, "auto-name: SDK query spawn failed");
            return None;
        }
    };

    let mut rx = query.take_message_rx();
    let mut accumulated_text = String::new();

    while let Some(msg_result) = rx.recv().await {
        let msg = match msg_result {
            Ok(m) => m,
            Err(e) => {
                debug!(feature_id, error = %e, "auto-name: stream error");
                continue;
            }
        };

        match &msg {
            SdkMessage::StreamEvent { event, .. } => match event {
                StreamEventData::ContentBlockStart {
                    content_block: ContentBlock::Text { text },
                    ..
                } => {
                    accumulated_text.push_str(text);
                }
                StreamEventData::ContentBlockDelta {
                    delta: ContentDelta::TextDelta { text },
                    ..
                } => {
                    accumulated_text.push_str(text);
                }
                _ => {}
            },
            SdkMessage::Assistant { message, .. } => {
                for block in &message.content {
                    if let ContentBlock::Text { text } = block {
                        accumulated_text.push_str(text);
                    }
                }
            }
            SdkMessage::Result { .. } => {
                debug!(feature_id, "auto-name: received Result, breaking out of stream loop");
                break;
            }
            _ => {}
        }
    }

    debug!(feature_id, accumulated_text = %accumulated_text, "auto-name: stream loop finished");

    // Extract name from markers, fall back to full text
    let re = Regex::new(r"__FEATURE_NAME_START__(.+?)__FEATURE_NAME_END__").unwrap();
    let raw_name = match re.captures(&accumulated_text) {
        Some(caps) => caps.get(1).unwrap().as_str().to_string(),
        None => accumulated_text,
    };

    let name = raw_name.trim().trim_matches(|c| c == '"' || c == '\'').to_string();

    if name.is_empty() {
        warn!(feature_id, "auto-name: empty name extracted");
        return None;
    }

    // Update DB
    if let Err(e) = sqlx::query("UPDATE features SET title = ? WHERE id = ?")
        .bind(&name)
        .bind(feature_id)
        .execute(&pool)
        .await
    {
        error!(feature_id, error = %e, "auto-name: DB update failed");
        return None;
    }

    // Notify frontend via WS envelope
    let payload = FeatureRenamedPayload {
        feature_id,
        title: name.clone(),
    };
    let envelope = WsEnvelope::new(
        "session",
        "feature.renamed",
        serde_json::to_value(&payload).unwrap(),
    );
    let json: String = envelope.into();
    let _ = ws_sender.send(Message::Text(json.into()));

    info!(feature_id, name = %name, "auto-named feature");
    Some(name)
}
