-- Task decomposition for custom workflow execute phases.
-- Stores individual tasks created by "tasks" phase agents via MCP tools.

CREATE TABLE IF NOT EXISTS workflow_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    source_phase_slug TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    commit_message TEXT NOT NULL DEFAULT '',
    order_index INTEGER NOT NULL DEFAULT 0,
    parallel_group INTEGER NOT NULL DEFAULT 0,
    depends_on TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(feature_id, source_phase_slug, title)
);

-- Add decompose_from to workflow_phases: slug of upstream phase whose tasks expand this phase.
ALTER TABLE workflow_phases ADD COLUMN decompose_from TEXT NOT NULL DEFAULT '';
