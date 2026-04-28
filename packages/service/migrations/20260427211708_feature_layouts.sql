-- Named feature layouts: workspace-wide saved tab grid configurations.
-- Backs the splittable grid in ws-feature / ws-session pages. Per-feature
-- *current* layout state stays in `feature_settings` (key='layout_state').

CREATE TABLE IF NOT EXISTS feature_layouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    -- JSON-serialized FeatureLayoutState (splitRoot + dockedTabIds + rootActiveTabId).
    -- Treated as opaque on the backend; the frontend owns the Zod schema.
    config TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- At most one default at a time. Partial unique index keeps non-default rows
-- (is_default = 0) unconstrained while forcing uniqueness on the lone "1".
CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_layouts_single_default
    ON feature_layouts(is_default) WHERE is_default = 1;
