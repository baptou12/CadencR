use serde_json::Value;

fn image_prompt_part(item: &Value) -> Option<opencode_sdk_rs::PromptPart> {
    let media_type = item
        .get("source")
        .and_then(|source| source.get("media_type"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)?;
    let data = item
        .get("source")
        .and_then(|source| source.get("data"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)?;
    let url = format!("data:{media_type};base64,{data}");

    Some(opencode_sdk_rs::PromptPart::File {
        mime: media_type,
        filename: None,
        url,
    })
}

pub(super) fn prompt_parts_from_content(content: Value) -> Vec<opencode_sdk_rs::PromptPart> {
    match content {
        Value::String(text) => vec![opencode_sdk_rs::PromptPart::Text { text }],
        Value::Array(items) => items
            .into_iter()
            .map(|item| {
                let item_type = item.get("type").and_then(Value::as_str);
                match item_type {
                    Some("text") => item
                        .get("text")
                        .and_then(Value::as_str)
                        .map(|text| opencode_sdk_rs::PromptPart::Text {
                            text: text.to_string(),
                        })
                        .unwrap_or(opencode_sdk_rs::PromptPart::Raw(item)),
                    Some("image") => {
                        image_prompt_part(&item).unwrap_or(opencode_sdk_rs::PromptPart::Raw(item))
                    }
                    _ => opencode_sdk_rs::PromptPart::Raw(item),
                }
            })
            .collect(),
        other => vec![opencode_sdk_rs::PromptPart::Raw(other)],
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn converts_image_blocks_to_file_parts() {
        let parts = super::prompt_parts_from_content(json!([
            { "type": "text", "text": "Look at this" },
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": "abc123"
                }
            }
        ]));

        assert_eq!(parts.len(), 2);
        assert!(matches!(
            &parts[0],
            opencode_sdk_rs::PromptPart::Text { text } if text == "Look at this"
        ));
        assert!(matches!(
            &parts[1],
            opencode_sdk_rs::PromptPart::File { mime, filename, url }
                if mime == "image/png"
                    && filename.is_none()
                    && url == "data:image/png;base64,abc123"
        ));
    }

    #[test]
    fn preserves_malformed_image_blocks_as_raw() {
        let parts = super::prompt_parts_from_content(json!([
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png"
                }
            }
        ]));

        assert_eq!(parts.len(), 1);
        assert!(matches!(&parts[0], opencode_sdk_rs::PromptPart::Raw(_)));
    }
}
