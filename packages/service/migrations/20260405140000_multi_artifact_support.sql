-- Multi-artifact support: allow multiple typed artifacts per phase.
-- Adds artifact_type column to workflow_artifacts and artifact_types to workflow_phases.

-- SQLite doesn't support ALTER TABLE DROP CONSTRAINT, so recreate the table.
CREATE TABLE workflow_artifacts_new (
    id INTEGER PRIMARY KEY,
    feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    phase_slug TEXT NOT NULL,
    artifact_type TEXT NOT NULL DEFAULT 'default',
    content TEXT NOT NULL DEFAULT '',
    agent_session_id INTEGER REFERENCES agent_sessions(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(feature_id, phase_slug, artifact_type)
);

INSERT INTO workflow_artifacts_new (id, feature_id, phase_slug, artifact_type, content, agent_session_id, created_at, updated_at)
SELECT id, feature_id, phase_slug, 'default', content, agent_session_id, created_at, updated_at
FROM workflow_artifacts;

DROP TABLE workflow_artifacts;
ALTER TABLE workflow_artifacts_new RENAME TO workflow_artifacts;

-- Add artifact_types JSON array to workflow_phases
ALTER TABLE workflow_phases ADD COLUMN artifact_types TEXT NOT NULL DEFAULT '[]';
