-- Claude Code profiles: named env var sets applied when spawning the CLI.
-- The literal name `default` is reserved; it is never stored as a row and
-- signals "inject no extra env". Active profile name lives in `settings`
-- under the key `claude_code_active_profile` (absent / empty / "default"
-- all mean the default).
CREATE TABLE claude_code_profiles (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    env_json   TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- User-added Claude Code models. Merged into the live catalog alongside the
-- CLI-probed list; on id collision the user entry wins so descriptions can
-- be overridden.
CREATE TABLE claude_code_custom_models (
    id          INTEGER PRIMARY KEY,
    model_id    TEXT NOT NULL UNIQUE,
    label       TEXT NOT NULL,
    description TEXT,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
