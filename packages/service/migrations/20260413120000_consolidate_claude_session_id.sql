-- Consolidate claude_session_id into runtime_session_id.
-- Backfill, drop the legacy column, then rename the archive table.

-- Backfill runtime_session_id from claude_session_id where missing.
UPDATE agent_sessions
SET runtime_session_id = claude_session_id
WHERE runtime_session_id IS NULL AND claude_session_id IS NOT NULL;

-- Drop the legacy column (SQLite 3.35.0+ supports ALTER TABLE DROP COLUMN).
ALTER TABLE agent_sessions DROP COLUMN claude_session_id;

-- Rename the session_claude_ids archive table and its column.
ALTER TABLE session_claude_ids RENAME TO session_runtime_ids;
ALTER TABLE session_runtime_ids RENAME COLUMN claude_session_id TO runtime_session_id;
