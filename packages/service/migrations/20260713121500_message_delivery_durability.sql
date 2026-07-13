-- Snapshot/reconnect clients need the same receipt state as live clients.
ALTER TABLE agent_messages ADD COLUMN delivery_state TEXT CHECK (
    delivery_state IS NULL OR delivery_state IN (
        'pending_agent', 'received_agent', 'delivery_unknown', 'delivery_failed'
    )
);

-- Queue claims and scheduled-message claims are durable external-side-effect
-- barriers. A process restart can identify and recover abandoned claims.
ALTER TABLE agent_session_message_queue ADD COLUMN claim_token TEXT;
ALTER TABLE agent_session_message_queue ADD COLUMN claimed_at TEXT;
ALTER TABLE agent_session_message_queue ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE scheduled_messages ADD COLUMN claim_token TEXT;
ALTER TABLE scheduled_messages ADD COLUMN claimed_at TEXT;
ALTER TABLE scheduled_messages ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
