-- Narrow the agent_messages full-text index to content worth searching.
--
-- Measured on a 4.8 GB database, `agent_messages_fts_data` was 1,347 MB — 28%
-- of the whole file — and `tool_result` rows alone accounted for 2,039 MB of
-- the 3,154 MB indexed. Excluding them takes the index to 305 MB while leaving
-- every other message type searchable, including `tool_call` (the command,
-- path, and pattern arguments, which are exactly what a "which feature touched
-- this file" search matches on) and `tool_error`.
--
-- Losing `tool_result` from the index is the deliberate trade, and it is a real
-- loss rather than a free one. The desktop conversation search is client-side
-- over loaded blocks and is genuinely unaffected. But the MCP search tools
-- (`project_find_related_sessions`, `workspace_recent_activity`, and any read
-- narrowed by `query`) MATCH against this index, so an agent can no longer find
-- a session by a string that only ever appeared in command output — and
-- `include_tool_details` does not rescue it, since that expands rows once found
-- rather than making them findable. Those tools therefore return a
-- `search_scope` note (`TOOL_RESULTS_NOT_INDEXED`) so an empty result set can't
-- be mistaken for "that text was never here".
--
-- What is NOT changed, deliberately:
--   * `detail` stays `full`. `fts_literal_query` wraps every MCP query in
--     double quotes, so every search is a phrase query, and phrase queries
--     require position information. `detail=none`/`column` would save more and
--     break all of them.
--   * `columnsize` stays on. Turning it off saves 4 MB and permanently
--     forecloses `bm25()` ranking, which the search would benefit from far
--     more than it benefits from those 4 MB.
--
-- The index is repopulated here, synchronously, even though that costs ~25s on
-- a database this size. Deferring it to a background pass was tried and is not
-- safe: `agent_messages_ad`/`_au` issue a `'delete'` against the index, and on
-- an external-content FTS5 table deleting a row that was never indexed doesn't
-- no-op — it writes a negative entry and the next query fails with "database
-- disk image is malformed". A rewind, a feature deletion, or any other delete
-- of a historical row during the backfill window would trip it. Paying the
-- rebuild once, inline, removes the window entirely.

DROP TRIGGER IF EXISTS agent_messages_ai;
DROP TRIGGER IF EXISTS agent_messages_ad;
DROP TRIGGER IF EXISTS agent_messages_au;
DROP TABLE IF EXISTS agent_messages_fts;

CREATE VIRTUAL TABLE agent_messages_fts USING fts5(
    content,
    content='agent_messages',
    content_rowid='id',
    tokenize='unicode61'
);

-- Each trigger filters on its own side of the row. `INSERT ... SELECT ... WHERE`
-- rather than a trigger `WHEN` clause so one trigger per event can handle a row
-- whose message_type differs between `old` and `new`: the delete uses `old`, the
-- insert uses `new`, and a row moving into or out of `tool_result` is handled
-- correctly in both directions.
CREATE TRIGGER agent_messages_ai AFTER INSERT ON agent_messages BEGIN
    INSERT INTO agent_messages_fts(rowid, content)
    SELECT new.id, COALESCE(new.content, '')
    WHERE COALESCE(new.message_type, '') <> 'tool_result';
END;

CREATE TRIGGER agent_messages_ad AFTER DELETE ON agent_messages BEGIN
    INSERT INTO agent_messages_fts(agent_messages_fts, rowid, content)
    SELECT 'delete', old.id, COALESCE(old.content, '')
    WHERE COALESCE(old.message_type, '') <> 'tool_result';
END;

-- `OF content, message_type` rather than `OF content`: whether a row belongs in
-- the index is now a function of both columns, so a change to either has to
-- resync it. Watching only `content` would let a row that moved into or out of
-- `tool_result` keep the index's old opinion of it — stranding an entry for a
-- deleted row, or issuing a delete for a row that was never indexed. Listing the
-- columns rather than dropping the `OF` clause entirely keeps the trigger off
-- the frequent `delivery_state` writes, whose re-indexing would only add
-- tombstones.
CREATE TRIGGER agent_messages_au AFTER UPDATE OF content, message_type ON agent_messages BEGIN
    INSERT INTO agent_messages_fts(agent_messages_fts, rowid, content)
    SELECT 'delete', old.id, COALESCE(old.content, '')
    WHERE COALESCE(old.message_type, '') <> 'tool_result';
    INSERT INTO agent_messages_fts(rowid, content)
    SELECT new.id, COALESCE(new.content, '')
    WHERE COALESCE(new.message_type, '') <> 'tool_result';
END;

-- Must match the `agent_messages_ai` filter exactly: a row indexed here that
-- the trigger would skip (or the reverse) leaves the index disagreeing with the
-- table it shadows.
INSERT INTO agent_messages_fts(rowid, content)
SELECT id, COALESCE(content, '') FROM agent_messages
WHERE COALESCE(message_type, '') <> 'tool_result';

-- Dropping the old index returns pages to SQLite's freelist, not to the
-- filesystem (`auto_vacuum` is disabled on existing databases). Startup owns
-- the only safe VACUUM window, before the read pool and HTTP server exist.
INSERT INTO maintenance_state (key, value, updated_at)
VALUES ('database_compaction_requested', '1', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at;
