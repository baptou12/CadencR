//! Build the message-content value/string sent to (and persisted for) a
//! prompt turn. Kept separate from the permission bridge so each file stays
//! focused and within the module size limit.

use crate::domain::ws_session::protocol::ImagePayload;

pub(crate) fn build_content_value(text: &str, images: &[ImagePayload]) -> serde_json::Value {
    if images.is_empty() {
        serde_json::Value::String(text.to_string())
    } else {
        let mut blocks: Vec<serde_json::Value> =
            Vec::with_capacity(images.len() + usize::from(!text.is_empty()));
        if !text.is_empty() {
            blocks.push(serde_json::json!({
                "type": "text",
                "text": text
            }));
        }
        for img in images {
            blocks.push(serde_json::json!({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": img.mime_type,
                    "data": img.base64
                }
            }));
        }
        serde_json::Value::Array(blocks)
    }
}

pub(crate) fn build_persist_content(text: &str, images: &[ImagePayload]) -> String {
    if images.is_empty() {
        text.to_string()
    } else {
        let content = build_content_value(text, images);
        serde_json::to_string(&content).unwrap_or_else(|_| text.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{build_content_value, ImagePayload};

    #[test]
    fn content_blocks_match_text_presence() {
        let images = vec![ImagePayload {
            base64: "abc".into(),
            mime_type: "image/png".into(),
        }];
        let image_only = build_content_value("", &images);
        assert_eq!(image_only.as_array().map(Vec::len), Some(1));
        assert_eq!(image_only[0]["type"], "image");
        assert_eq!(image_only[0]["source"]["data"], "abc");
        let content = build_content_value("hello", &images);
        assert_eq!(content.as_array().map(Vec::len), Some(2));
        assert_eq!(content[0]["text"], "hello");
        assert_eq!(content[1]["source"]["data"], "abc");
    }
}
