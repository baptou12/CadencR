-- Custom Actions: user-defined commands surfaced as buttons in the feature header.
-- Replaces the hardcoded "Open in Zed" / "Open in Terminal" buttons.

CREATE TABLE IF NOT EXISTS custom_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    command TEXT NOT NULL,                              -- shell command, may contain ${VAR} placeholders
    icon_data TEXT,                                     -- data URI, e.g. data:image/svg+xml;base64,...
    scope TEXT NOT NULL CHECK(scope IN ('global','project')),
    project_id INTEGER,                                 -- NULL when scope='global'
    position INTEGER NOT NULL DEFAULT 0,                -- display order in the header
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CHECK (
        (scope = 'global'  AND project_id IS NULL) OR
        (scope = 'project' AND project_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_custom_actions_project
    ON custom_actions(project_id);

-- Per-feature value for a single ${VAR} declared by an action's command.
CREATE TABLE IF NOT EXISTS custom_action_variables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_id INTEGER NOT NULL,
    feature_id INTEGER NOT NULL,
    var_name TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (action_id)  REFERENCES custom_actions(id) ON DELETE CASCADE,
    FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE,
    UNIQUE(action_id, feature_id, var_name)
);

-- Run history: one row per execution, persists stdout/stderr and exit code.
CREATE TABLE IF NOT EXISTS custom_action_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_id INTEGER NOT NULL,
    feature_id INTEGER NOT NULL,
    exit_code INTEGER,                                  -- NULL while still running
    stdout TEXT NOT NULL DEFAULT '',
    stderr TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    triggered_by TEXT NOT NULL DEFAULT 'manual'
        CHECK(triggered_by IN ('manual','schedule')),
    FOREIGN KEY (action_id)  REFERENCES custom_actions(id) ON DELETE CASCADE,
    FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_custom_action_runs_action_feature
    ON custom_action_runs(action_id, feature_id, started_at DESC);

-- Per-(action, feature) periodic schedule. Backend scheduler reads enabled rows.
CREATE TABLE IF NOT EXISTS custom_action_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_id INTEGER NOT NULL,
    feature_id INTEGER NOT NULL,
    interval_seconds INTEGER NOT NULL CHECK(interval_seconds >= 5),
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at TEXT,
    FOREIGN KEY (action_id)  REFERENCES custom_actions(id) ON DELETE CASCADE,
    FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE,
    UNIQUE(action_id, feature_id)
);
