pub(in crate::domain::agents::acp::runtime) fn apply_line_window(
    content: &str,
    line: Option<u64>,
    limit: Option<u64>,
) -> String {
    let start = line.unwrap_or(1).max(1) as usize;
    let take = limit.map(|n| n as usize).unwrap_or(usize::MAX);
    content
        .lines()
        .skip(start - 1)
        .take(take)
        .collect::<Vec<_>>()
        .join("\n")
}
