-- Some migrated legacy databases and historical migration fixtures predate
-- custom-model registration entirely. Recreate the base table when absent so
-- the additive capability columns remain safe for those databases too.
CREATE TABLE IF NOT EXISTS claude_code_custom_models (
    id          INTEGER PRIMARY KEY,
    model_id    TEXT NOT NULL UNIQUE,
    label       TEXT NOT NULL,
    description TEXT,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE claude_code_custom_models ADD COLUMN supports_effort BOOLEAN;
ALTER TABLE claude_code_custom_models ADD COLUMN supported_effort_levels_json TEXT;
ALTER TABLE claude_code_custom_models ADD COLUMN default_effort_level TEXT;
