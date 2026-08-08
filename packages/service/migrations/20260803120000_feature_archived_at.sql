-- Retention needs to know *when* a feature was archived, not just that it is.
--
-- `archived_at` is stamped by the repository on the active → archived
-- transition and cleared on the way back, so un-archiving restarts the clock.
-- `compacted_at` records the last time the retention sweep stripped heavy tool
-- payloads out of the feature's messages; it keeps the sweep from re-scanning
-- work it has already done.
--
-- Backfill: existing archived rows predate the column, so derive their
-- archive time from the last message the feature produced (its real "went
-- quiet" moment), falling back to the feature's own created_at when it never
-- had any messages. Active/draft rows stay NULL — they are not on the clock.
ALTER TABLE features ADD COLUMN archived_at TEXT;
ALTER TABLE features ADD COLUMN compacted_at TEXT;

UPDATE features
SET archived_at = COALESCE(
    (
        SELECT MAX(m.created_at)
        FROM agent_sessions s
        JOIN agent_messages m ON m.session_id = s.id
        WHERE s.feature_id = features.id
    ),
    created_at
)
WHERE status = 'archived' AND archived_at IS NULL;

-- The sweep first narrows on archived status/time before checking recent
-- message activity, so index the pair rather than status alone.
CREATE INDEX IF NOT EXISTS idx_features_archived_at
    ON features(status, archived_at);

-- Archived features can still receive scheduled/background messages. Any new
-- activity restarts the retention decision and makes a previously compacted
-- feature eligible for a later sweep once the configured quiet period passes.
-- Keeping this in SQLite covers every writer, not only one application path.
CREATE TRIGGER IF NOT EXISTS agent_messages_reset_archived_compaction
AFTER INSERT ON agent_messages
BEGIN
    UPDATE features
    SET compacted_at = NULL
    WHERE status = 'archived'
      AND compacted_at IS NOT NULL
      AND id = (
          SELECT feature_id FROM agent_sessions WHERE id = new.session_id
      );
END;
