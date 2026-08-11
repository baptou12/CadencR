//! SQL used by the archived-thread retention walk.

/// Features whose archive and latest-message clocks have both elapsed.
pub(super) const DUE_FEATURES_SQL: &str = r#"
SELECT f.id FROM features f
WHERE f.status = 'archived'
  AND f.archived_at IS NOT NULL
  AND f.compacted_at IS NULL
  AND f.archived_at <= datetime('now', ?)
  AND NOT EXISTS (
    SELECT 1 FROM agent_sessions s
    JOIN agent_messages m ON m.session_id = s.id
    WHERE s.feature_id = f.id
      AND m.created_at > datetime('now', ?)
  )
ORDER BY f.archived_at
"#;

/// Select only ids first; eligible payloads can each be many megabytes.
pub(super) const FEATURE_MESSAGE_IDS_SQL: &str = r#"
SELECT m.id FROM agent_messages m
JOIN agent_sessions s ON s.id = m.session_id
WHERE s.feature_id = ?
  AND m.message_type IN ('tool_call', 'tool_result', 'tool_error')
  AND COALESCE(m.tool_name, (
    SELECT c.tool_name FROM agent_messages c
    WHERE c.session_id = m.session_id
      AND c.tool_use_id = m.tool_use_id
      AND c.message_type = 'tool_call'
    LIMIT 1
  )) = 'Bash'
  AND m.id > ?
ORDER BY m.id
LIMIT ?
"#;

/// Load one already-Bash-filtered payload without holding a page of large text.
pub(super) const FEATURE_MESSAGE_SQL: &str = "SELECT content FROM agent_messages WHERE id = ?";
