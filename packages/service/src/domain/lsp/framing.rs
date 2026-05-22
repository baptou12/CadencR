//! LSP base-protocol framing: `Content-Length: N\r\n\r\n` followed by N raw
//! UTF-8 JSON-RPC bytes. See LSP 3.17 §3 "Base Protocol".
//!
//! We deliberately only honour `Content-Length`; `Content-Type` is allowed
//! per the spec but every modern server omits it and the `utf8` charset is
//! already mandatory.

use std::io;

use tokio::io::{AsyncBufReadExt, AsyncReadExt};

/// Reads one framed LSP message off `reader`. Returns `Ok(None)` on clean
/// EOF (the child closed stdout), or a typed I/O error if the framing is
/// malformed — the proxy treats either case as a terminal session failure.
pub async fn read_frame<R>(reader: &mut R) -> io::Result<Option<Vec<u8>>>
where
    R: AsyncBufReadExt + Unpin,
{
    let Some(content_length) = read_headers(reader).await? else {
        return Ok(None);
    };
    let mut buf = vec![0u8; content_length];
    reader.read_exact(&mut buf).await?;
    Ok(Some(buf))
}

/// Encodes `payload` as one framed LSP message ready to write to a server's
/// stdin. `payload` MUST already be valid UTF-8 JSON-RPC; framing does not
/// validate the body.
pub fn encode_frame(payload: &[u8]) -> Vec<u8> {
    let header = format!("Content-Length: {}\r\n\r\n", payload.len());
    let mut out = Vec::with_capacity(header.len() + payload.len());
    out.extend_from_slice(header.as_bytes());
    out.extend_from_slice(payload);
    out
}

/// Reads HTTP-style headers until the blank `\r\n` separator. Returns the
/// `Content-Length` value, or `Ok(None)` on EOF *before any header bytes
/// arrive* (clean shutdown).
async fn read_headers<R>(reader: &mut R) -> io::Result<Option<usize>>
where
    R: AsyncBufReadExt + Unpin,
{
    let mut content_length: Option<usize> = None;
    let mut line = String::new();
    let mut saw_any = false;

    loop {
        line.clear();
        let n = reader.read_line(&mut line).await?;
        if n == 0 {
            return if saw_any {
                Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "EOF mid-header",
                ))
            } else {
                Ok(None)
            };
        }
        saw_any = true;
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some(rest) = trimmed.strip_prefix("Content-Length:") {
            content_length = rest
                .trim()
                .parse()
                .map(Some)
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        }
        // Other headers (e.g. legacy Content-Type) are tolerated and dropped.
    }

    content_length
        .map(Some)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing Content-Length header"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::BufReader;

    #[tokio::test]
    async fn roundtrip_simple_message() {
        let payload = br#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#;
        let framed = encode_frame(payload);
        let mut reader = BufReader::new(&framed[..]);
        let got = read_frame(&mut reader).await.unwrap().unwrap();
        assert_eq!(got, payload);
    }

    #[tokio::test]
    async fn tolerates_extra_headers() {
        let body = br#"{"jsonrpc":"2.0"}"#;
        let raw = format!(
            "Content-Type: application/vscode-jsonrpc; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            std::str::from_utf8(body).unwrap()
        );
        let mut reader = BufReader::new(raw.as_bytes());
        let got = read_frame(&mut reader).await.unwrap().unwrap();
        assert_eq!(got, body);
    }

    #[tokio::test]
    async fn clean_eof_returns_none() {
        let mut reader = BufReader::new(&b""[..]);
        assert!(read_frame(&mut reader).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn truncated_body_is_error() {
        let raw = b"Content-Length: 50\r\n\r\nshort";
        let mut reader = BufReader::new(&raw[..]);
        let err = read_frame(&mut reader).await.unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::UnexpectedEof);
    }

    #[tokio::test]
    async fn missing_content_length_is_error() {
        let raw = b"X-Other: 1\r\n\r\n";
        let mut reader = BufReader::new(&raw[..]);
        let err = read_frame(&mut reader).await.unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn encode_prefixes_length() {
        let frame = encode_frame(b"hello");
        let as_str = std::str::from_utf8(&frame).unwrap();
        assert_eq!(as_str, "Content-Length: 5\r\n\r\nhello");
    }
}
