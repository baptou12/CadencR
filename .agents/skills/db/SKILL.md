---
name: db
description: Query or modify the Cadencr SQLite database
user-invocable: true
allowed-tools: Bash(sqlite3 *)
---

# Cadencr Database

Run queries against the Cadencr SQLite database at:
`~/Library/Application Support/cadencr/cadencr.db`

Use `sqlite3` for all operations. Always wrap the DB path in double quotes (`"`) to avoid backslash escaping — e.g. `sqlite3 "$HOME/Library/Application Support/cadencr/cadencr.db"`.

## Tables

- `features` (id, project_id, title, status, type, created_at)
- `plans` (id, feature_id, content, status, created_at)
- `phases` (id, plan_id, step_number, title, status, complexity, commit_message, tasks, files, order_index, prompt)
- `agent_sessions` (id, feature_id, agent_type, status)
- `agent_messages` (id, session_id, role, content, created_at)
- `projects` (id, name, path, created_at)
- `settings`, `project_settings`, `feature_settings`
- `diff_comments`

## Usage

If `$ARGUMENTS` is a raw SQL query, run it directly. Otherwise interpret the user's intent and build the appropriate query.

When deleting agent sessions, also delete their messages from `agent_messages`. When resetting a feature, update its status and clean up related sessions/messages as needed. Always show results after mutations to confirm changes.
