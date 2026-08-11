-- Bookkeeping for the background storage-maintenance job.
--
-- The job's passes walk `agent_messages` (hundreds of thousands of rows, several
-- GB of content) stripping payloads that are duplicated or past their retention
-- window. That walk is far too slow to run inside a migration — measured at 23s
-- on a 4.8 GB database — so it runs batched in the background after boot and
-- records how far it got here. Without a cursor every launch would re-scan the
-- whole table to discover there is nothing left to do.
--
-- Deliberately a generic key/value table rather than columns: each pass owns its
-- own keys, and adding a pass shouldn't need a schema change.
CREATE TABLE IF NOT EXISTS maintenance_state (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
