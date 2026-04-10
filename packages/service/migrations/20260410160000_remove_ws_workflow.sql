-- Remove custom workflow definition tables (ws_workflow module removed)
-- The workflow_definition_id column stays on features (SQLite limitation) but is always NULL.

DELETE FROM workflow_tasks;
DELETE FROM workflow_artifacts;
DELETE FROM workflow_phases;
DELETE FROM workflow_definitions;

UPDATE features SET workflow_definition_id = NULL WHERE workflow_definition_id IS NOT NULL;

DROP TABLE IF EXISTS workflow_tasks;
DROP TABLE IF EXISTS workflow_artifacts;
DROP TABLE IF EXISTS workflow_phases;
DROP TABLE IF EXISTS workflow_definitions;
