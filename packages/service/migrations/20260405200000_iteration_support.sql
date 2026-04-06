-- Add iteration support for loop-until-satisfied phase execution

-- Queue: track iteration state
ALTER TABLE workflow_queue ADD COLUMN iteration_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workflow_queue ADD COLUMN iteration_history TEXT;

-- Recreate workflow_phases to widen gate_type CHECK and add max_iterations
CREATE TABLE workflow_phases_new (
    id INTEGER PRIMARY KEY,
    workflow_definition_id INTEGER NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    gate_type TEXT NOT NULL CHECK(gate_type IN ('auto', 'approval', 'manual', 'iterate')),
    system_prompt_template TEXT NOT NULL DEFAULT '',
    command_prompt_template TEXT NOT NULL DEFAULT '',
    artifact_template TEXT NOT NULL DEFAULT '',
    input_phase_slugs TEXT DEFAULT '[]',
    model_override TEXT DEFAULT '',
    agent_type TEXT NOT NULL DEFAULT 'workflow',
    decompose_from TEXT NOT NULL DEFAULT '',
    artifact_types TEXT NOT NULL DEFAULT '[]',
    max_iterations INTEGER NOT NULL DEFAULT 1,
    UNIQUE(workflow_definition_id, slug),
    UNIQUE(workflow_definition_id, order_index)
);

INSERT INTO workflow_phases_new
    SELECT id, workflow_definition_id, name, slug, order_index, gate_type,
           system_prompt_template, command_prompt_template, artifact_template,
           input_phase_slugs, model_override, agent_type, decompose_from,
           artifact_types, 1
    FROM workflow_phases;

DROP TABLE workflow_phases;
ALTER TABLE workflow_phases_new RENAME TO workflow_phases;
