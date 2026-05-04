ALTER TABLE agent_sessions ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_agent_sessions_is_pinned ON agent_sessions(is_pinned);
