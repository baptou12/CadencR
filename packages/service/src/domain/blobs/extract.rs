//! Moves inline base64 image payloads out of message content and into the blob
//! store, leaving a `cadencr-blob://<hash>` reference behind.
//!
//! Pasted user images can be multi-megabyte base64 strings. Base64 inflates the
//! bytes ~33% over the raw image, and every one of those characters would
//! otherwise live in SQLite and its indexes.
//!
//! Only the exact persisted user-message image block is eligible:
//!
//! ```json
//! {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "iVBOR…"}}
//! ```
//!
//! The rewrite replaces *only* the payload string, never the structure around
//! it, so exactly one convention reaches the frontend: wherever it reads image
//! bytes, the value may be a `cadencr-blob://` reference instead of literal
//! base64. Sibling fields like `media_type` keep working unchanged.

use serde_json::Value;

use super::store;

/// Scheme marking an off-loaded payload. Must stay in sync with
/// `BLOB_REF_SCHEME` in `packages/desktop/src/lib/blob-ref.ts`.
pub const BLOB_REF_SCHEME: &str = "cadencr-blob://";

/// Payloads at or below this size stay inline. A file per 200-byte tracking
/// pixel costs more in inodes and lookups than it saves, and the size
/// distribution is overwhelmingly multi-KB screenshots.
const MIN_OFFLOAD_BYTES: usize = 4096;
#[derive(Clone, Copy)]
enum RewriteMode {
    Store,
    HashOnly,
}
/// Rewrite recognized user-message image blocks in `content` into blob refs.
///
/// Returns `None` when nothing changed, so callers can skip a pointless UPDATE
/// (each one re-indexes the row via the `agent_messages_au` FTS trigger).
/// Content that isn't JSON is returned untouched: only structured payloads
/// carry images.
#[cfg(test)]
pub fn offload_content(content: &str) -> Option<String> {
    match try_offload_content(content) {
        Ok(rewritten) => rewritten,
        Err(error) => {
            tracing::warn!("failed to off-load inline payloads: {error}");
            None
        }
    }
}

/// Fallible form used by maintenance, where a storage failure must leave the
/// cursor before this row so a later sweep retries it.
pub fn try_offload_content(content: &str) -> anyhow::Result<Option<String>> {
    try_rewrite_content(content, RewriteMode::Store)
}

/// Normalize inline payloads to references without writing files, so duplicate
/// checks can compare an inline retry with an already-rewritten row.
pub fn canonicalize_content(content: &str) -> Option<String> {
    try_rewrite_content(content, RewriteMode::HashOnly)
        .ok()
        .flatten()
}

fn try_rewrite_content(content: &str, mode: RewriteMode) -> anyhow::Result<Option<String>> {
    if !content.contains("base64") {
        return Ok(None);
    }
    let Ok(mut value) = serde_json::from_str::<Value>(content) else {
        return Ok(None);
    };
    if !try_offload_value(&mut value, mode)? {
        return Ok(None);
    }
    Ok(Some(serde_json::to_string(&value)?))
}

/// Inspect top-level user-message blocks in place.
fn try_offload_value(value: &mut Value, mode: RewriteMode) -> anyhow::Result<bool> {
    match value {
        Value::Array(items) => {
            let mut changed = false;
            for item in items {
                changed = try_offload_image_block(item, mode)? || changed;
            }
            Ok(changed)
        }
        _ => Ok(false),
    }
}

/// Only the persisted user-message shape the desktop knows how to resolve.
/// Tool JSON may contain image-looking strings as source code, command
/// output, or protocol data; walking every string would silently rewrite it.
fn try_offload_image_block(value: &mut Value, mode: RewriteMode) -> anyhow::Result<bool> {
    let Some(block) = value.as_object_mut() else {
        return Ok(false);
    };
    if block.get("type").and_then(Value::as_str) != Some("image") {
        return Ok(false);
    }
    let Some(source) = block.get_mut("source").and_then(Value::as_object_mut) else {
        return Ok(false);
    };
    if source.get("type").and_then(Value::as_str) != Some("base64")
        || !source
            .get("media_type")
            .and_then(Value::as_str)
            .is_some_and(is_supported_image_media_type)
    {
        return Ok(false);
    }
    let Some(data) = source.get("data").and_then(Value::as_str) else {
        return Ok(false);
    };
    let Some(replacement) = try_offload_payload(data, mode)? else {
        return Ok(false);
    };
    source.insert("data".to_string(), Value::String(replacement));
    Ok(true)
}

fn is_supported_image_media_type(media_type: &str) -> bool {
    matches!(
        media_type,
        "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml"
    )
}

/// Off-load one string if it holds a base64 image payload, returning the
/// reference that replaces it.
///
/// Accepts both a full `data:` URL and a bare base64 body (the `source.data`
/// shape). A bare string is only treated as a payload when it is long enough to
/// be worth storing *and* actually decodes, which keeps ordinary prose — which
/// is never valid base64 at that length — from being misread as an image.
#[cfg(test)]
fn offload_payload(text: &str) -> Option<String> {
    match try_offload_payload(text, RewriteMode::Store) {
        Ok(replacement) => replacement,
        Err(error) => {
            tracing::warn!("failed to off-load an inline payload to the blob store: {error}");
            None
        }
    }
}

fn try_offload_payload(text: &str, mode: RewriteMode) -> anyhow::Result<Option<String>> {
    if text.starts_with(BLOB_REF_SCHEME) {
        return Ok(None); // already off-loaded
    }
    // A `data:` URL declares itself to be a payload; a bare string only looks
    // like one, so it has to prove it decodes to something we recognize.
    let (body, must_sniff) = match data_url_body(text) {
        Some(body) => (body, false),
        None if looks_like_bare_base64(text) => (text, true),
        None => return Ok(None),
    };
    if body.len() < MIN_OFFLOAD_BYTES {
        return Ok(None);
    }

    use base64::Engine as _;
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(body.trim()) else {
        return Ok(None);
    };
    if bytes.len() < MIN_OFFLOAD_BYTES {
        return Ok(None);
    }
    // Without this, `base64 -w0 archive.zip` in a terminal produces command
    // output that is entirely base64-alphabet, and the off-load would replace
    // the user's visible output with a reference to bytes nothing renders.
    if must_sniff && super::sniff_media_type(&bytes) == "application/octet-stream" {
        return Ok(None);
    }
    let hash = match mode {
        RewriteMode::Store => store::put(&bytes)?,
        RewriteMode::HashOnly => store::hash_bytes(&bytes),
    };
    Ok(Some(format!("{BLOB_REF_SCHEME}{hash}")))
}

/// The payload of a `data:image/<type>;base64,<payload>` URL.
fn data_url_body(text: &str) -> Option<&str> {
    // Only image consumers know how to resolve `cadencr-blob://`. Rewriting a
    // PDF or arbitrary tool data URL would leave an opaque reference where its
    // protocol still expects inline bytes.
    if !text.starts_with("data:image/") {
        return None;
    }
    text.split_once(";base64,").map(|(_, body)| body)
}

/// Whether a bare string is plausibly a base64 image body. Deliberately strict:
/// prose and code contain characters outside the base64 alphabet, so a
/// whole-string alphabet check is enough to avoid decoding anything else.
fn looks_like_bare_base64(text: &str) -> bool {
    text.len() >= MIN_OFFLOAD_BYTES
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=')
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The hash inside a reference, or `None` if `text` isn't one. Test-only:
    /// references are resolved by the frontend, not the backend.
    fn blob_ref_hash(text: &str) -> Option<&str> {
        let hash = text.strip_prefix(BLOB_REF_SCHEME)?;
        store::is_valid_hash(hash).then_some(hash)
    }

    /// Terminal output from something like `base64 -w0 archive.zip`: entirely
    /// base64-alphabet and well over the threshold, but not an image. Replacing
    /// it with a reference would blank out what the user actually ran.
    #[test]
    fn leaves_bare_base64_that_is_not_an_image_alone() {
        use base64::Engine as _;
        let not_an_image = base64::engine::general_purpose::STANDARD
            .encode(std::iter::repeat_n(0x7Fu8, MIN_OFFLOAD_BYTES * 2).collect::<Vec<_>>());

        assert!(offload_payload(&not_an_image).is_none());
    }

    /// Non-image data URLs belong to attachment/tool protocols the blob reader
    /// does not understand, so they stay inline.
    #[test]
    fn leaves_non_image_data_urls_alone() {
        use base64::Engine as _;
        let body = base64::engine::general_purpose::STANDARD
            .encode(std::iter::repeat_n(0x7Fu8, MIN_OFFLOAD_BYTES * 2).collect::<Vec<_>>());
        let url = format!("data:application/pdf;base64,{body}");

        assert!(offload_payload(&url).is_none());
    }

    fn big_png_base64() -> String {
        use base64::Engine as _;
        // A real PNG header followed by enough bytes to clear the threshold.
        let mut bytes = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        bytes.extend(std::iter::repeat_n(0xAB, MIN_OFFLOAD_BYTES * 2));
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    #[test]
    fn leaves_an_image_looking_string_outside_the_user_image_shape_alone() {
        let content = serde_json::json!([{
            "type": "input_image",
            "image_url": format!("data:image/png;base64,{}", big_png_base64()),
        }])
        .to_string();

        assert!(offload_content(&content).is_none());
    }

    #[test]
    fn leaves_unsupported_image_media_types_inline() {
        let content = serde_json::json!([{
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/avif",
                "data": big_png_base64()
            },
        }])
        .to_string();

        assert!(offload_content(&content).is_none());
    }

    #[test]
    fn offloads_the_nested_source_data_shape() {
        let content = serde_json::json!([{
            "type": "image",
            "source": { "type": "base64", "media_type": "image/png", "data": big_png_base64() },
        }])
        .to_string();

        let rewritten = offload_content(&content).expect("payload should off-load");
        let parsed: Value = serde_json::from_str(&rewritten).unwrap();

        assert!(blob_ref_hash(parsed[0]["source"]["data"].as_str().unwrap()).is_some());
        // Structure around the payload is untouched, so media_type still resolves.
        assert_eq!(
            parsed[0]["source"]["media_type"],
            serde_json::json!("image/png")
        );
        assert_eq!(parsed[0]["source"]["type"], serde_json::json!("base64"));
    }

    #[test]
    fn offloads_every_image_in_a_multi_image_message() {
        let content = serde_json::json!([
            { "type": "text", "text": "look at these" },
            { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": big_png_base64() } },
            { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": big_png_base64() } },
        ])
        .to_string();

        let parsed: Value =
            serde_json::from_str(&offload_content(&content).expect("changed")).unwrap();

        assert_eq!(parsed[0]["text"], serde_json::json!("look at these"));
        assert!(blob_ref_hash(parsed[1]["source"]["data"].as_str().unwrap()).is_some());
        assert!(blob_ref_hash(parsed[2]["source"]["data"].as_str().unwrap()).is_some());
    }

    #[test]
    fn identical_images_collapse_to_one_blob() {
        let payload = big_png_base64();
        let content = serde_json::json!([
            { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": payload } },
            { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": payload } },
        ])
        .to_string();

        let parsed: Value =
            serde_json::from_str(&offload_content(&content).expect("changed")).unwrap();
        assert_eq!(parsed[0]["source"]["data"], parsed[1]["source"]["data"]);
    }

    #[test]
    fn leaves_prose_and_small_payloads_alone() {
        for content in [
            serde_json::json!([{ "type": "text", "text": "base64 is a fine encoding" }])
                .to_string(),
            // Under the threshold: a file per tiny icon isn't worth it.
            serde_json::json!([{ "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo=" } }]).to_string(),
            "not json at all".to_string(),
            serde_json::json!([{ "text": "no images here" }]).to_string(),
        ] {
            assert!(
                offload_content(&content).is_none(),
                "should not rewrite: {content}"
            );
        }
    }

    #[test]
    fn long_prose_is_not_mistaken_for_base64() {
        // Spaces and punctuation put this outside the base64 alphabet.
        let prose = "the quick brown fox jumps over the lazy dog. ".repeat(400);
        let content = serde_json::json!([{ "type": "text", "text": prose }]).to_string();
        assert!(offload_content(&content).is_none());
    }

    #[test]
    fn never_rewrites_image_data_inside_arbitrary_tool_fields() {
        let image = format!("data:image/png;base64,{}", big_png_base64());
        let content = serde_json::json!({
            "command": "print embedded fixture",
            "source_code": format!("const fixture = {image:?};"),
            "result": { "output": image }
        })
        .to_string();

        assert!(offload_content(&content).is_none());
    }

    #[test]
    fn requires_a_declared_image_media_type() {
        let content = serde_json::json!([{
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "application/octet-stream",
                "data": big_png_base64()
            },
        }])
        .to_string();

        assert!(offload_content(&content).is_none());
    }

    #[test]
    fn is_idempotent() {
        let content = serde_json::json!([{
            "type": "image",
            "source": { "type": "base64", "media_type": "image/png", "data": big_png_base64() },
        }])
        .to_string();

        let once = offload_content(&content).expect("first pass rewrites");
        assert!(
            offload_content(&once).is_none(),
            "a reference must not be re-off-loaded"
        );
    }

    #[test]
    fn blob_ref_hash_rejects_malformed_references() {
        assert!(blob_ref_hash("cadencr-blob://not-a-hash").is_none());
        assert!(blob_ref_hash("https://example.com/x.png").is_none());
        assert!(blob_ref_hash(&format!("{BLOB_REF_SCHEME}{}", "a".repeat(64))).is_some());
    }
}
