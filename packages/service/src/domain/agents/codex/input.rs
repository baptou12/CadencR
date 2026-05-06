use base64::Engine;
use serde_json::Value;
use tempfile::TempPath;

use crate::domain::agents::adapter::RuntimeError;

pub fn user_input_from_content(
    content: Value,
    temp_files: &mut Vec<TempPath>,
) -> Result<Vec<Value>, RuntimeError> {
    match content {
        Value::String(text) => Ok(vec![text_input(text)]),
        Value::Array(items) => {
            let mut inputs = Vec::new();
            for item in items {
                if let Some(input) = input_from_block(item, temp_files)? {
                    inputs.push(input);
                }
            }
            Ok(inputs)
        }
        other => Ok(vec![text_input(other.to_string())]),
    }
}

fn input_from_block(
    item: Value,
    temp_files: &mut Vec<TempPath>,
) -> Result<Option<Value>, RuntimeError> {
    match item.get("type").and_then(Value::as_str) {
        Some("text") => Ok(item
            .get("text")
            .and_then(Value::as_str)
            .map(|text| text_input(text.to_string()))),
        Some("image") => image_input_from_block(&item, temp_files).map(Some),
        Some("localImage") => Ok(item
            .get("path")
            .and_then(Value::as_str)
            .map(|path| serde_json::json!({ "type": "localImage", "path": path }))),
        _ => Ok(Some(text_input(item.to_string()))),
    }
}

fn image_input_from_block(
    item: &Value,
    temp_files: &mut Vec<TempPath>,
) -> Result<Value, RuntimeError> {
    let source = item.get("source").unwrap_or(item);
    if let Some(url) = source.get("url").and_then(Value::as_str) {
        return Ok(serde_json::json!({ "type": "image", "url": url }));
    }

    let base64_data = source
        .get("data")
        .and_then(Value::as_str)
        .or_else(|| item.get("base64").and_then(Value::as_str))
        .ok_or_else(|| RuntimeError::new("image input missing base64 data"))?;
    let mime = source
        .get("media_type")
        .and_then(Value::as_str)
        .or_else(|| source.get("mimeType").and_then(Value::as_str))
        .unwrap_or("image/png");
    let file = write_temp_image(base64_data, mime)?;
    let path = file.to_path_buf();
    temp_files.push(file);
    Ok(serde_json::json!({
        "type": "localImage",
        "path": path.to_string_lossy()
    }))
}

fn text_input(text: String) -> Value {
    serde_json::json!({
        "type": "text",
        "text": text,
        "text_elements": []
    })
}

fn write_temp_image(base64_data: &str, mime: &str) -> Result<TempPath, RuntimeError> {
    let dir = std::env::temp_dir().join("cadencr-codex-images");
    std::fs::create_dir_all(&dir).map_err(|e| {
        RuntimeError::new(format!(
            "failed to create Codex image temp directory {}: {e}",
            dir.display()
        ))
    })?;
    let extension = extension_for_mime(mime);
    let mut file = tempfile::Builder::new()
        .prefix("codex-image-")
        .suffix(&format!(".{extension}"))
        .tempfile_in(&dir)
        .map_err(|e| {
            RuntimeError::new(format!(
                "failed to create Codex image temp file in {}: {e}",
                dir.display()
            ))
        })?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| RuntimeError::new(format!("failed to decode image input: {e}")))?;
    std::io::Write::write_all(&mut file, &bytes).map_err(|e| {
        RuntimeError::new(format!(
            "failed to write Codex image temp file {}: {e}",
            file.path().display()
        ))
    })?;
    Ok(file.into_temp_path())
}

fn extension_for_mime(mime: &str) -> &'static str {
    match mime {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "png",
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::user_input_from_content;

    #[test]
    fn converts_text_content_to_codex_user_input() {
        let mut temp_files = Vec::new();
        let input = user_input_from_content(json!("hello"), &mut temp_files).unwrap();

        assert_eq!(
            input,
            vec![json!({ "type": "text", "text": "hello", "text_elements": [] })]
        );
        assert!(temp_files.is_empty());
    }

    #[test]
    fn invalid_image_base64_returns_error() {
        let mut temp_files = Vec::new();
        let error = user_input_from_content(
            json!([{ "type": "image", "source": { "data": "not base64" } }]),
            &mut temp_files,
        )
        .expect_err("invalid image should fail");

        assert!(error.to_string().contains("decode image"));
    }

    #[test]
    fn image_base64_is_written_to_lifetime_bound_temp_file() {
        let mut temp_files = Vec::new();
        let input = user_input_from_content(
            json!([{
                "type": "image",
                "source": {
                    "data": "aGVsbG8=",
                    "media_type": "image/webp"
                }
            }]),
            &mut temp_files,
        )
        .unwrap();
        let path = input[0]["path"].as_str().unwrap();

        assert!(path.ends_with(".webp"));
        assert!(std::path::Path::new(path).exists());
        temp_files.clear();
        assert!(!std::path::Path::new(path).exists());
    }
}
