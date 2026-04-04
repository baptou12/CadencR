-- Add pending_approval as a valid workflow_queue status.
-- SQLite doesn't support ALTER CHECK constraints, so we recreate the table.
-- Step 1: Create new table with updated CHECK
CREATE TABLE workflow_queue_new (
    id INTEGER PRIMARY KEY,
    feature_id INTEGER NOT NULL REFERENCES features(id),
    workflow_type TEXT NOT NULL DEFAULT 'feature_build'
        CHECK(workflow_type IN ('feature_build', 'code_review', 'design_improvement', 'bug_fix', 'custom')),
    item_type TEXT NOT NULL,
    phase_id INTEGER REFERENCES phases(id),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'blocked', 'ready', 'running', 'paused', 'completed', 'error', 'skipped', 'pending_approval')),
    order_index INTEGER NOT NULL,
    group_index INTEGER,
    config JSON,
    agent_session_id INTEGER REFERENCES agent_sessions(id),
    result JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    ended_at DATETIME,
    pid INTEGER,
    max_retries INTEGER NOT NULL DEFAULT 1,
    retry_count INTEGER NOT NULL DEFAULT 0
);

-- Step 2: Copy data
INSERT INTO workflow_queue_new SELECT * FROM workflow_queue;

-- Step 3: Drop old table and rename
DROP TABLE workflow_queue;
ALTER TABLE workflow_queue_new RENAME TO workflow_queue;

-- Step 4: Recreate indexes
CREATE INDEX idx_workflow_queue_feature ON workflow_queue(feature_id);
CREATE INDEX idx_workflow_queue_status ON workflow_queue(status);
CREATE INDEX idx_workflow_queue_type ON workflow_queue(workflow_type);

-- Step 5: Recreate dependencies table referencing new table
-- (SQLite FKs reference table name, not OID, so existing workflow_dependencies still works)
