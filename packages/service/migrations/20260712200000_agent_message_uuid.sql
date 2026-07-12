-- Canonical Cadencr identity for logical user messages.
--
-- The numeric `id` remains the ordering/pagination cursor. `message_uuid`
-- survives every delivery surface (live event, snapshot, reconnect, mirror)
-- and makes transport retries idempotent within one session. Legacy rows stay
-- NULL and continue to use their numeric id as a compatibility identity.
ALTER TABLE agent_messages ADD COLUMN message_uuid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_messages_session_message_uuid
    ON agent_messages(session_id, message_uuid)
    WHERE message_uuid IS NOT NULL;

-- A queued transport request must retain the same identity until it is
-- persisted as an agent_messages row. This also makes a repeated internal MCP
-- request idempotent before the target session becomes available.
ALTER TABLE agent_session_message_queue ADD COLUMN message_uuid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_message_queue_session_message_uuid
    ON agent_session_message_queue(target_session_id, message_uuid)
    WHERE message_uuid IS NOT NULL;

-- Immediate provider dispatch is an external side effect and therefore cannot
-- be inferred from message-row insertion. Track it durably so an idempotent
-- transport retry can re-attempt a failed dispatch without inserting or
-- concurrently sending the logical user message twice.
CREATE TABLE IF NOT EXISTS agent_message_dispatches (
    message_id INTEGER PRIMARY KEY REFERENCES agent_messages(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'dispatching', 'dispatched', 'error')
    ),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    claim_token TEXT,
    claimed_at TEXT,
    dispatched_at TEXT,
    error TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
