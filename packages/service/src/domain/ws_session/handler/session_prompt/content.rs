//! Build the message-content value/string sent to (and persisted for) a
//! prompt turn. Kept separate from the permission bridge so each file stays
//! focused and within the module size limit.

use base64::Engine;

use crate::domain::agents::{codex, opencode};
use crate::domain::ws_session::protocol::PromptSendPayload;

use super::conversation_references::ResolvedConversationReference;

pub(crate) fn expand_prompt_for_provider<'a>(
    text: &'a str,
    conversation_references: &[ResolvedConversationReference],
) -> std::borrow::Cow<'a, str> {
    let command_expanded = crate::domain::agents::orchestration_skills::expand_prompt(text);
    super::conversation_references::append_instructions(command_expanded, conversation_references)
}

#[derive(Clone, Copy)]
pub(crate) struct PromptAttachmentView<'a> {
    base64: &'a str,
    mime_type: &'a str,
    file_name: &'a str,
    kind: Option<&'a str>,
}

pub(crate) fn build_content_value_for_provider(
    provider_id: &str,
    text: &str,
    attachments: &[PromptAttachmentView<'_>],
) -> serde_json::Value {
    if attachments.is_empty() {
        return serde_json::Value::String(text.to_string());
    }
    let mut blocks: Vec<serde_json::Value> =
        Vec::with_capacity(attachments.len() + usize::from(!text.is_empty()));
    if !text.is_empty() {
        blocks.push(text_block(text));
    }
    for attachment in attachments {
        blocks.push(attachment_block(provider_id, attachment));
    }
    serde_json::Value::Array(blocks)
}

pub(crate) fn build_persist_content(
    text: &str,
    attachments: &[PromptAttachmentView<'_>],
) -> String {
    if attachments.is_empty() {
        text.to_string()
    } else {
        let content = build_persist_content_value(text, attachments);
        serde_json::to_string(&content).unwrap_or_else(|_| text.to_string())
    }
}

pub(crate) fn payload_attachments(payload: &PromptSendPayload) -> Vec<PromptAttachmentView<'_>> {
    let mut attachments = Vec::with_capacity(payload.attachments.len() + payload.images.len());
    attachments.extend(
        payload
            .attachments
            .iter()
            .map(|attachment| PromptAttachmentView {
                base64: &attachment.base64,
                mime_type: &attachment.mime_type,
                file_name: &attachment.file_name,
                kind: attachment.kind.as_deref(),
            }),
    );
    attachments.extend(payload.images.iter().map(|image| PromptAttachmentView {
        base64: &image.base64,
        mime_type: &image.mime_type,
        file_name: "image",
        kind: Some("image"),
    }));
    attachments
}

fn build_persist_content_value(
    text: &str,
    attachments: &[PromptAttachmentView<'_>],
) -> serde_json::Value {
    let mut blocks: Vec<serde_json::Value> =
        Vec::with_capacity(attachments.len() + usize::from(!text.is_empty()));
    if !text.is_empty() {
        blocks.push(text_block(text));
    }
    for attachment in attachments {
        blocks.push(persist_attachment_block(attachment));
    }
    serde_json::Value::Array(blocks)
}

fn attachment_block(provider_id: &str, attachment: &PromptAttachmentView<'_>) -> serde_json::Value {
    let kind = attachment.kind.unwrap_or("image");
    if kind == "image" {
        return anthropic_image_block(attachment);
    }
    if provider_id == codex::PROVIDER_ID {
        return codex_attachment_block(kind, attachment);
    }
    if provider_id == opencode::PROVIDER_ID {
        return acp_attachment_block(kind, attachment);
    }
    claude_attachment_block(kind, attachment)
}

fn persist_attachment_block(attachment: &PromptAttachmentView<'_>) -> serde_json::Value {
    let kind = attachment.kind.unwrap_or("image");
    if kind == "image" {
        return anthropic_image_block(attachment);
    }
    serde_json::json!({
        "type": "attachment",
        "file_name": attachment.file_name,
        "kind": kind,
        "media_type": attachment.mime_type
    })
}

fn anthropic_image_block(attachment: &PromptAttachmentView<'_>) -> serde_json::Value {
    serde_json::json!({
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": attachment.mime_type,
            "data": attachment.base64
        }
    })
}

fn claude_attachment_block(kind: &str, attachment: &PromptAttachmentView<'_>) -> serde_json::Value {
    if kind == "document" {
        return serde_json::json!({
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": attachment.mime_type,
                "data": attachment.base64
            },
            "title": attachment.file_name
        });
    }
    text_block(&format!(
        "Attached file `{}` ({})\n\n{}",
        attachment.file_name,
        attachment.mime_type,
        decode_text(attachment.base64)
    ))
}

fn codex_attachment_block(kind: &str, attachment: &PromptAttachmentView<'_>) -> serde_json::Value {
    serde_json::json!({
        "type": "attachment",
        "file_name": attachment.file_name,
        "kind": kind,
        "media_type": attachment.mime_type,
        "data": attachment.base64
    })
}

fn acp_attachment_block(kind: &str, attachment: &PromptAttachmentView<'_>) -> serde_json::Value {
    if kind == "audio" {
        return serde_json::json!({
            "type": "audio",
            "mimeType": attachment.mime_type,
            "data": attachment.base64
        });
    }
    let uri = format!("file:///attachments/{}", attachment.file_name);
    if is_text_mime(attachment.mime_type) {
        let text = decode_text(attachment.base64);
        return serde_json::json!({
            "type": "resource",
            "resource": { "uri": uri, "mimeType": attachment.mime_type, "text": text }
        });
    }
    serde_json::json!({
        "type": "resource",
        "resource": { "uri": uri, "mimeType": attachment.mime_type, "blob": attachment.base64 }
    })
}

fn text_block(text: &str) -> serde_json::Value {
    serde_json::json!({ "type": "text", "text": text })
}

fn decode_text(base64_data: &str) -> String {
    decode_text_if_valid(base64_data).unwrap_or_else(|| "[binary content omitted]".to_string())
}

fn decode_text_if_valid(base64_data: &str) -> Option<String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .ok()?;
    String::from_utf8(bytes).ok()
}

fn is_text_mime(mime_type: &str) -> bool {
    mime_type.starts_with("text/")
        || matches!(
            mime_type,
            "application/json" | "application/xml" | "application/csv"
        )
}

#[cfg(test)]
mod tests {
    use super::{build_content_value_for_provider, build_persist_content, PromptAttachmentView};

    fn attachment<'a>(
        base64: &'a str,
        mime_type: &'a str,
        file_name: &'a str,
        kind: &'a str,
    ) -> PromptAttachmentView<'a> {
        PromptAttachmentView {
            base64,
            mime_type,
            file_name,
            kind: Some(kind),
        }
    }

    #[test]
    fn content_blocks_match_text_presence() {
        let images = vec![attachment("abc", "image/png", "image.png", "image")];
        let image_only = build_content_value_for_provider("claude_code", "", &images);
        assert_eq!(image_only.as_array().map(Vec::len), Some(1));
        assert_eq!(image_only[0]["type"], "image");
        assert_eq!(image_only[0]["source"]["data"], "abc");
        let content = build_content_value_for_provider("claude_code", "hello", &images);
        assert_eq!(content.as_array().map(Vec::len), Some(2));
        assert_eq!(content[0]["text"], "hello");
        assert_eq!(content[1]["source"]["data"], "abc");
    }

    #[test]
    fn claude_content_uses_documents_and_text_for_non_images() {
        let attachments = vec![
            attachment("JVBERg==", "application/pdf", "brief.pdf", "document"),
            attachment("YSxiXG4xLDI=", "text/csv", "data.csv", "text"),
        ];
        let content = build_content_value_for_provider("claude_code", "review", &attachments);
        assert_eq!(content.as_array().map(Vec::len), Some(3));
        assert_eq!(content[1]["type"], "document");
        assert_eq!(content[1]["source"]["media_type"], "application/pdf");
        assert_eq!(content[2]["type"], "text");
        assert!(content[2]["text"].as_str().unwrap().contains("data.csv"));
        assert!(content[2]["text"].as_str().unwrap().contains("a,b"));
    }

    #[test]
    fn acp_content_uses_audio_and_resource_blocks() {
        let attachments = vec![
            attachment("UklG", "audio/wav", "clip.wav", "audio"),
            attachment("JVBERg==", "application/pdf", "brief.pdf", "resource"),
        ];
        let content = build_content_value_for_provider("opencode", "review", &attachments);
        assert_eq!(content.as_array().map(Vec::len), Some(3));
        assert_eq!(content[1]["type"], "audio");
        assert_eq!(content[2]["type"], "resource");
        assert_eq!(content[2]["resource"]["blob"], "JVBERg==");
    }

    #[test]
    fn codex_content_preserves_pdf_attachments_for_file_references() {
        let attachments = vec![attachment(
            "JVBERg==",
            "application/pdf",
            "brief.pdf",
            "document",
        )];

        let content = build_content_value_for_provider("codex_cli", "review", &attachments);

        assert_eq!(content.as_array().map(Vec::len), Some(2));
        assert_eq!(content[1]["type"], "attachment");
        assert_eq!(content[1]["file_name"], "brief.pdf");
        assert_eq!(content[1]["media_type"], "application/pdf");
        assert_eq!(content[1]["data"], "JVBERg==");
    }

    #[test]
    fn persist_content_keeps_non_image_attachments_compact_and_provider_neutral() {
        let attachments = vec![attachment(
            "JVBERg==",
            "application/pdf",
            "brief.pdf",
            "document",
        )];

        let content = build_persist_content("review", &attachments);
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();

        assert_eq!(parsed.as_array().map(Vec::len), Some(2));
        assert_eq!(parsed[1]["type"], "attachment");
        assert_eq!(parsed[1]["file_name"], "brief.pdf");
        assert_eq!(parsed[1]["media_type"], "application/pdf");
        assert!(parsed[1].get("data").is_none());
    }
}
