pub(super) fn truncate(content: &str, max_lines: usize, max_chars: usize) -> (String, bool) {
    if content.len() <= max_chars {
        let mut newline_count = 0usize;
        let mut over_cap = false;
        for &byte in content.as_bytes() {
            if byte == b'\n' {
                newline_count += 1;
                if newline_count >= max_lines {
                    over_cap = true;
                    break;
                }
            }
        }
        if !over_cap {
            return (content.to_owned(), false);
        }
    }
    let lines: Vec<&str> = content.split('\n').collect();
    let line_truncated = lines.len() > max_lines;
    let line_limited = if line_truncated {
        lines[lines.len() - max_lines..].join("\n")
    } else {
        content.to_owned()
    };
    if line_limited.len() <= max_chars {
        return (line_limited, line_truncated);
    }
    (
        tail_by_utf8_bytes(&line_limited, max_chars).to_owned(),
        true,
    )
}

fn tail_by_utf8_bytes(content: &str, max_bytes: usize) -> &str {
    if content.len() <= max_bytes {
        return content;
    }
    let mut start = content.len() - max_bytes;
    while !content.is_char_boundary(start) {
        start += 1;
    }
    &content[start..]
}
