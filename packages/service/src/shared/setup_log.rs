const MAX_SETUP_LOG_TRANSPORT_BYTES: usize = 128 * 1024;
const TRUNCATED_PREFIX: &str = "[... earlier setup output truncated ...]\n";

/// Keep persisted setup diagnostics intact while bounding copies sent to UI clients.
pub(crate) fn setup_log_for_transport(log: String) -> String {
    if log.len() <= MAX_SETUP_LOG_TRANSPORT_BYTES {
        return log;
    }

    let tail_bytes = MAX_SETUP_LOG_TRANSPORT_BYTES - TRUNCATED_PREFIX.len();
    let mut start = log.len() - tail_bytes;
    while !log.is_char_boundary(start) {
        start += 1;
    }

    format!("{TRUNCATED_PREFIX}{}", &log[start..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_setup_logs_without_splitting_utf8() {
        let log = format!("old\n{}retained", "é".repeat(MAX_SETUP_LOG_TRANSPORT_BYTES));

        let bounded = setup_log_for_transport(log);

        assert!(bounded.len() <= MAX_SETUP_LOG_TRANSPORT_BYTES);
        assert!(bounded.starts_with(TRUNCATED_PREFIX));
        assert!(bounded.ends_with("retained"));
    }
}
