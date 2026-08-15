-- Codex app-server multiplexes the root thread and its sub-agent threads over
-- one runtime stream. Each thread reports an independent cumulative counter,
-- so a checkpoint must be scoped to that native counter rather than shared by
-- every thread attached to the Cadencr session.
--
-- `IF NOT EXISTS` also keeps historical migration fixtures valid. Some legacy
-- databases were seeded past the original usage migration before the table was
-- introduced; an empty compatibility table safely converges them here.
CREATE TABLE IF NOT EXISTS provider_usage_checkpoints (
    session_id INTEGER NOT NULL,
    provider_id TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, provider_id),
    FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
);

CREATE TABLE provider_usage_checkpoints_scoped (
    session_id INTEGER NOT NULL,
    provider_id TEXT NOT NULL,
    scope_id TEXT NOT NULL DEFAULT '',
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, provider_id, scope_id),
    FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
);

-- Preserve every provider's existing counter under the empty root scope. Live
-- Codex events normalize the root thread to this scope and use native thread
-- ids only for child counters. The inner join drops only orphaned checkpoints
-- whose session no longer exists; such rows cannot ever be resumed and already
-- violate the old table's foreign key.
INSERT INTO provider_usage_checkpoints_scoped
    (session_id, provider_id, scope_id, input_tokens, output_tokens)
SELECT
    checkpoint.session_id,
    checkpoint.provider_id,
    '',
    checkpoint.input_tokens,
    checkpoint.output_tokens
FROM provider_usage_checkpoints AS checkpoint
INNER JOIN agent_sessions AS session ON session.id = checkpoint.session_id;

DROP TABLE provider_usage_checkpoints;
ALTER TABLE provider_usage_checkpoints_scoped RENAME TO provider_usage_checkpoints;
