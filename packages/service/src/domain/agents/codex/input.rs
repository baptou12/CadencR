use std::path::{Path, PathBuf};

use base64::Engine;
use serde_json::Value;

use crate::domain::agents::adapter::RuntimeError;

pub fn user_input_from_content(
    content: Value,
    temp_paths: &mut Vec<PathBuf>,
) -> Result<Vec<Value>, RuntimeError> {
    match content {
        Value::String(text) => Ok(vec![text_input(text)]),
        Value::Array(items) => {
            let mut inputs = Vec::new();
            for item in items {
                if let Some(input) = input_from_block(item, temp_paths)? {
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
    temp_paths: &mut Vec<PathBuf>,
) -> Result<Option<Value>, RuntimeError> {
    match item.get("type").and_then(Value::as_str) {
        Some("text") => Ok(item
            .get("text")
            .and_then(Value::as_str)
            .map(|text| text_input(text.to_string()))),
        Some("image") => image_input_from_block(&item, temp_paths).map(Some),
        Some("localImage") => Ok(item
            .get("path")
            .and_then(Value::as_str)
            .map(|path| serde_json::json!({ "type": "localImage", "path": path }))),
        _ => Ok(Some(text_input(item.to_string()))),
    }
}

fn image_input_from_block(
    item: &Value,
    temp_paths: &mut Vec<PathBuf>,
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
    let path = write_temp_image(base64_data, mime)?;
    temp_paths.push(path.clone());
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

fn write_temp_image(base64_data: &str, mime: &str) -> Result<PathBuf, RuntimeError> {
    let dir = std::env::temp_dir().join("cadence-codex-images");
    std::fs::create_dir_all(&dir).map_err(|e| {
        RuntimeError::new(format!(
            "failed to create Codex image temp directory {}: {e}",
            dir.display()
        ))
    })?;
    let extension = extension_for_mime(mime);
    let path = dir.join(format!("{}.{}", uuid::Uuid::new_v4(), extension));
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| RuntimeError::new(format!("failed to decode image input: {e}")))?;
    std::fs::write(&path, bytes).map_err(|e| {
        RuntimeError::new(format!(
            "failed to write Codex image temp file {}: {e}",
            path.display()
        ))
    })?;
    Ok(path)
}

fn extension_for_mime(mime: &str) -> &'static str {
    match mime {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "png",
    }
}

pub fn remove_temp_images(paths: &[PathBuf]) {
    for path in paths {
        remove_file(path);
    }
}

fn remove_file(path: &Path) {
    let _ = std::fs::remove_file(path);
}
