---
name: db
description: Query or modify the Cadencr SQLite database
user-invocable: true
allowed-tools: Bash(sqlite3 *)
---

# Cadencr Database

Cadencr stores its state in a SQLite file. There are two locations to be aware of:

| Context | Path | When |
|---|---|---|
| **Dev** (default) | `packages/service/cadencr.local.db` | When running `pnpm dev` — set by `CADENCR_DB_PATH=./cadencr.local.db` in `packages/service/.env`. |
| **Production** (packaged Electron) | `~/.cadencr/database/cadencr.db` | When the Electron sidecar spawns the service binary (see `packages/desktop/electron/main/sidecar.ts`). |
| Custom | Whatever `CADENCR_DB_PATH` / `--db-path` points at | Override either of the above. |

Default to the **dev** path unless the user is clearly debugging the packaged app. If unsure, ask. Always wrap the path in double quotes — e.g. `sqlite3 "packages/service/cadencr.local.db"`.

## Tables

The dev DB currently contains these tables (run `.tables` to confirm — schema drifts as migrations land):

```
agent_messages              feature_layouts
agent_sessions              feature_settings
claude_code_custom_models   features
claude_code_profiles        phases
custom_action_runs          plans
custom_action_schedules     project_settings
custom_action_variables     projects
custom_actions              prompt_history
diff_comments               session_runtime_ids
diff_viewed_files           settings
                            workflow_dependencies
                            workflow_queue
```

(`_sqlx_migrations` and `migrations` are migration bookkeeping — leave them alone.)

For exact column lists, run `.schema <table>` instead of trusting documentation — the column set evolves. Common entry points:

- `projects` → `features` → `plans` → `phases`
- `features` → `agent_sessions` → `agent_messages`
- `features` → `feature_layouts`, `feature_settings`
- `custom_actions` → `custom_action_runs`, `custom_action_schedules`, `custom_action_variables`
- `claude_code_profiles` → `claude_code_custom_models`
- `workflow_queue`, `workflow_dependencies` (orchestration state)

## Usage

If `$ARGUMENTS` is a raw SQL query, run it directly. Otherwise interpret the user's intent and build the query.

When mutating, honor foreign-key relations:

- Deleting an `agent_sessions` row → also delete its `agent_messages` (and `session_runtime_ids` referencing it, if any).
- Resetting a `features` row → clean related `agent_sessions` (+ their messages), `plans` (+ `phases`), `feature_layouts`, `workflow_queue` entries as appropriate.
- Deleting a `plan` → delete its `phases` first.

If you're not sure what depends on a row, inspect schemas with `.schema <table>` and search for `REFERENCES <target>` before deleting.

Always show results after mutations to confirm changes (e.g., follow an `UPDATE` with the matching `SELECT`).
