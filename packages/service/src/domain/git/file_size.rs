use crate::domain::git::models::FileContentBatchItem;

/// Files at or above this byte size are flagged as "large" — their content is
/// omitted from batch responses and the frontend renders a placeholder until
/// the user explicitly opts in. Picked to keep CodeMirror's synchronous Myers
/// diff under ~150 ms on Apple Silicon for code-shaped text.
pub const LARGE_FILE_BYTES: u64 = 200_000;

/// Number of bytes to sniff when probing for binary content (matches git's
/// own heuristic).
const BINARY_SNIFF_BYTES: usize = 8192;

/// Derive size + binary + large flags from already-fetched file content and
/// build the response item. We avoid extra `git cat-file -s` / `git show`
/// roundtrips: the size is just `String::len()` and binary detection looks
/// for a NUL byte in the first 8 KB of either side. NUL is a valid UTF-8
/// codepoint so `String::from_utf8_lossy` (used upstream when reading via
/// `git show`) preserves it.
///
/// `keep_large_content` controls whether oversized text content is kept in
/// the response. The batch endpoint sets it to false (placeholders only).
/// The single-file endpoint sets it to true: when the user clicks
/// "Display diff" we always return the content, even past the threshold.
/// Binary content is never returned regardless.
pub fn classify_content(
    file_path: String,
    old_content: String,
    new_content: String,
    keep_large_content: bool,
) -> FileContentBatchItem {
    let old_size = old_content.len() as u64;
    let new_size = new_content.len() as u64;
    let is_binary = bytes_have_binary_marker(old_content.as_bytes())
        || bytes_have_binary_marker(new_content.as_bytes());
    let is_large = old_size.max(new_size) >= LARGE_FILE_BYTES;

    let drop_content = is_binary || (is_large && !keep_large_content);
    let (old, new) = if drop_content {
        (None, None)
    } else {
        (Some(old_content), Some(new_content))
    };

    FileContentBatchItem {
        file_path,
        old_content: old,
        new_content: new,
        old_size,
        new_size,
        is_binary,
        is_large,
    }
}

pub(crate) fn bytes_have_binary_marker(bytes: &[u8]) -> bool {
    bytes.iter().take(BINARY_SNIFF_BYTES).any(|&b| b == 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(old: &str, new: &str, keep: bool) -> FileContentBatchItem {
        classify_content("a.txt".into(), old.into(), new.into(), keep)
    }

    #[test]
    fn classify_content_keeps_small_text() {
        let it = item("hello", "world!", false);
        assert_eq!(it.old_content.as_deref(), Some("hello"));
        assert_eq!(it.new_content.as_deref(), Some("world!"));
        assert_eq!(it.old_size, 5);
        assert_eq!(it.new_size, 6);
        assert!(!it.is_binary);
        assert!(!it.is_large);
    }

    #[test]
    fn classify_content_strips_large_text_in_batch_mode() {
        let big = "a".repeat(LARGE_FILE_BYTES as usize + 10);
        let it = item("", &big, false);
        assert!(it.is_large);
        assert!(!it.is_binary);
        assert!(it.old_content.is_none());
        assert!(it.new_content.is_none());
        assert_eq!(it.new_size, LARGE_FILE_BYTES + 10);
    }

    #[test]
    fn classify_content_keeps_large_text_when_opted_in() {
        let big = "a".repeat(LARGE_FILE_BYTES as usize + 10);
        let it = item("", &big, true);
        assert!(it.is_large);
        assert!(it.new_content.is_some());
    }

    #[test]
    fn classify_content_strips_binary_even_when_opted_in() {
        // NUL byte in the first 8 KB makes the content classify as binary.
        let bin = format!("hello\0world");
        let it = item("", &bin, true);
        assert!(it.is_binary);
        assert!(it.old_content.is_none());
        assert!(it.new_content.is_none());
    }

    #[test]
    fn classify_content_ignores_null_past_sniff_window() {
        // NUL beyond first 8 KB shouldn't classify as binary (matches git's
        // heuristic; avoids false positives on huge text files that happen
        // to include a NUL deep inside).
        let mut s = "a".repeat(BINARY_SNIFF_BYTES + 10);
        s.push('\0');
        let it = item("", &s, false);
        assert!(!it.is_binary);
    }
}
