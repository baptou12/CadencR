-- Queue workers discover one pending row per target session. Keep that wake-up
-- scan and the per-target claim bounded as queue history grows.
CREATE INDEX idx_agent_message_queue_pending_target
    ON agent_session_message_queue(target_session_id)
    WHERE status = 'pending';
