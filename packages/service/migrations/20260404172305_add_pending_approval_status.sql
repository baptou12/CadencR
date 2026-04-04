-- Add pending_approval as a valid workflow_queue status.
-- SQLite doesn't support ALTER CHECK constraints, so we recreate the table.
--
-- NOTE: workflow_dependencies has FK references to workflow_queue. Even though
-- SQLite FKs reference table names (not OIDs), DROP TABLE workflow_queue will
-- fail when PRAGMA foreign_keys = ON because child rows exist. We therefore
-- recreate workflow_dependencies as well to ensure integrity regardless of the
-- foreign_keys pragma state.

-- Step 1: Create new workflow_queue table with updated CHECK
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

-- Step 2: Copy workflow_queue data
INSERT INTO workflow_queue_new SELECT * FROM workflow_queue;

-- Step 3: Save workflow_dependencies data
CREATE TABLE workflow_dependencies_backup (
    id INTEGER,
    queue_item_id INTEGER,
    depends_on_item_id INTEGER
);
INSERT INTO workflow_dependencies_backup SELECT id, queue_item_id, depends_on_item_id FROM workflow_dependencies;

-- Step 4: Drop workflow_dependencies (removes FK constraint referencing workflow_queue)
DROP TABLE workflow_dependencies;

-- Step 5: Drop old workflow_queue and rename new one
DROP TABLE workflow_queue;
ALTER TABLE workflow_queue_new RENAME TO workflow_queue;

-- Step 6: Recreate workflow_dependencies with FK referencing the new workflow_queue
CREATE TABLE workflow_dependencies (
    id INTEGER PRIMARY KEY,
    queue_item_id INTEGER NOT NULL REFERENCES workflow_queue(id) ON DELETE CASCADE,
    depends_on_item_id INTEGER NOT NULL REFERENCES workflow_queue(id) ON DELETE CASCADE,
    UNIQUE(queue_item_id, depends_on_item_id)
);

-- Step 7: Restore dependency data
INSERT INTO workflow_dependencies SELECT id, queue_item_id, depends_on_item_id FROM workflow_dependencies_backup;
DROP TABLE workflow_dependencies_backup;

-- Step 8: Recreate indexes on workflow_queue
CREATE INDEX idx_workflow_queue_feature ON workflow_queue(feature_id);
CREATE INDEX idx_workflow_queue_status ON workflow_queue(status);
CREATE INDEX idx_workflow_queue_type ON workflow_queue(workflow_type);
