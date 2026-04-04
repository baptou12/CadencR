-- Workflow definitions: reusable workflow templates (presets + custom)
CREATE TABLE workflow_definitions (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    is_preset BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Workflow phases: ordered steps within a workflow definition
CREATE TABLE workflow_phases (
    id INTEGER PRIMARY KEY,
    workflow_definition_id INTEGER NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    gate_type TEXT NOT NULL CHECK(gate_type IN ('auto', 'approval', 'manual')),
    system_prompt_template TEXT NOT NULL DEFAULT '',
    command_prompt_template TEXT NOT NULL DEFAULT '',
    artifact_template TEXT NOT NULL DEFAULT '',
    input_phase_slugs TEXT DEFAULT '[]',
    model_override TEXT DEFAULT '',
    UNIQUE(workflow_definition_id, slug),
    UNIQUE(workflow_definition_id, order_index)
);

-- Workflow artifacts: per-feature, per-phase output content
CREATE TABLE workflow_artifacts (
    id INTEGER PRIMARY KEY,
    feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    phase_slug TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    agent_session_id INTEGER REFERENCES agent_sessions(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(feature_id, phase_slug)
);

-- Link features to workflow definitions (NULL = legacy flow)
ALTER TABLE features ADD COLUMN workflow_definition_id INTEGER REFERENCES workflow_definitions(id);
