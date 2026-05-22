pub const DEFAULT_AGENT_MESSAGE_LIMIT: i64 = 100;
pub const MAX_AGENT_MESSAGE_LIMIT: i64 = 200;

pub fn normalize_agent_message_limit(limit: Option<i64>) -> i64 {
    limit
        .unwrap_or(DEFAULT_AGENT_MESSAGE_LIMIT)
        .clamp(1, MAX_AGENT_MESSAGE_LIMIT)
}

#[cfg(test)]
mod tests {
    use super::normalize_agent_message_limit;

    #[test]
    fn normalize_agent_message_limit_defaults_and_clamps() {
        assert_eq!(normalize_agent_message_limit(None), 100);
        assert_eq!(normalize_agent_message_limit(Some(-5)), 1);
        assert_eq!(normalize_agent_message_limit(Some(50)), 50);
        assert_eq!(normalize_agent_message_limit(Some(5_000)), 200);
    }
}
