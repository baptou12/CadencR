//! Content-addressed storage for large binary payloads that used to live inline
//! in `agent_messages.content`.
//!
//! Pasted user-message images were stored as base64 inside the message JSON,
//! paying ~33% base64 inflation and forcing binary payloads through SQLite and
//! its FTS triggers.
//!
//! Images now live on disk keyed by content hash, and the message keeps a
//! `cadencr-blob://<hash>` reference. The frontend resolves references through
//! `GET /api/blobs/{hash}`, which is also the only way it can display them:
//! the renderer's CSP is `img-src 'self' data: blob:`, so bytes have to arrive
//! over the API and become an object URL rather than being linked directly.

pub mod dir;
pub mod extract;
pub mod routes;
pub mod store;

#[cfg(test)]
pub use extract::offload_content;
pub use extract::{canonicalize_content, try_offload_content};

/// Off-load large payloads without decoding, hashing, writing, or fsyncing on a
/// Tokio worker. Failure is deliberately fail-open: the caller persists the
/// original inline content instead of losing it.
pub async fn offload_content_async(content: &str) -> Option<String> {
    match try_offload_content_async(content).await {
        Ok(rewritten) => rewritten,
        Err(error) => {
            tracing::warn!("inline payload off-load task failed: {error}");
            None
        }
    }
}

pub async fn try_offload_content_async(content: &str) -> anyhow::Result<Option<String>> {
    if !content.contains("base64") {
        return Ok(None);
    }
    let owned = content.to_owned();
    tokio::task::spawn_blocking(move || try_offload_content(&owned))
        .await
        .map_err(anyhow::Error::from)?
}

/// Best-effort media-type sniff from magic bytes, for the read endpoint's
/// `Content-Type`. Only the formats an agent or a paste can actually produce
/// are recognized; anything else is served as opaque binary, which the frontend
/// still renders correctly because it builds its object URL from the response.
pub fn sniff_media_type(bytes: &[u8]) -> &'static str {
    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    if bytes.starts_with(PNG) {
        return "image/png";
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return "image/jpeg";
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return "image/gif";
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return "image/webp";
    }
    if bytes.starts_with(b"<svg") || bytes.starts_with(b"<?xml") {
        return "image/svg+xml";
    }
    "application/octet-stream"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniffs_the_formats_agents_produce() {
        assert_eq!(
            sniff_media_type(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00]),
            "image/png"
        );
        assert_eq!(sniff_media_type(&[0xFF, 0xD8, 0xFF, 0xE0]), "image/jpeg");
        assert_eq!(sniff_media_type(b"GIF89a...."), "image/gif");
        assert_eq!(sniff_media_type(b"RIFF\0\0\0\0WEBPVP8 "), "image/webp");
        assert_eq!(sniff_media_type(b"<svg xmlns=\"\">"), "image/svg+xml");
    }

    #[test]
    fn unknown_and_short_input_is_opaque_binary() {
        assert_eq!(sniff_media_type(b""), "application/octet-stream");
        assert_eq!(sniff_media_type(b"RIFF"), "application/octet-stream");
        assert_eq!(sniff_media_type(b"just text"), "application/octet-stream");
    }
}
