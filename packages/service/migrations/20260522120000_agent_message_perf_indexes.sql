-- Speed up feature-open hydration and older-history pagination.
--
-- The session-only index is not selective enough for:
--   - ORDER BY id DESC paginated history fetches
--
CREATE INDEX IF NOT EXISTS idx_agent_messages_session_id_desc
ON agent_messages(session_id, id DESC);
