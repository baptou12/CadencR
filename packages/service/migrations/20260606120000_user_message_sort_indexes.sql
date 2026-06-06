-- Speed up sidebar ordering by "most recent user message".
--
-- `list_projects` and `list_by_project` both join `agent_messages` filtered by
-- `role = 'user'` and take `MAX(created_at)` per session. The existing
-- session-only indexes (`idx_agent_messages_session`,
-- `idx_agent_messages_session_id_desc`) don't cover the `role` filter, so the
-- planner must scan every message in a session to find the latest user one.
-- This composite index lets SQLite seek straight to a session's user messages
-- and read the newest `created_at` directly.
CREATE INDEX IF NOT EXISTS idx_agent_messages_session_role_created
ON agent_messages(session_id, role, created_at);
