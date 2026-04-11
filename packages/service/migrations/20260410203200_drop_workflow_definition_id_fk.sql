-- Remove the workflow_definition_id column from features.
-- The referenced table (workflow_definitions) was dropped in a previous migration,
-- causing FK validation errors on INSERT even with NULL values.
ALTER TABLE features DROP COLUMN workflow_definition_id;
