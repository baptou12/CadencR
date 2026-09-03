-- MCP write tools must be undoable: replaying the inverse of a write needs the
-- state that existed before it. `previous_value` carries that snapshot as a
-- JSON payload written by the tool that performed the change.
--
-- Nullable with no backfill: read tools record nothing here, and writes that
-- predate this column have no snapshot to reconstruct — NULL means "no undo
-- material", not "the prior state was empty".
ALTER TABLE mcp_tool_audit_log ADD COLUMN previous_value TEXT;
