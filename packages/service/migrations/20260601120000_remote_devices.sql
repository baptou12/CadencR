-- Remote access: per-device bearer tokens (hashed at rest) plus an audit trail
-- of pairing/connect/revoke events.
--
-- Purely additive. Devices are soft-deleted via `revoked_at` (never hard
-- deleted), so `remote_audit.device_id` is a plain column rather than a foreign
-- key — there is no cascade to manage and revoked rows must stay queryable for
-- the audit history.
CREATE TABLE IF NOT EXISTS remote_devices (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    -- hex(sha256(pepper || raw_token)); the UNIQUE constraint also indexes lookups.
    token_hash   TEXT NOT NULL UNIQUE,
    label        TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT,
    -- Non-null once revoked. Revoked tokens are rejected at auth time.
    revoked_at   TEXT
);

CREATE TABLE IF NOT EXISTS remote_audit (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    -- 'pair' | 'connect' | 'revoke' | 'pair_rejected'
    event      TEXT NOT NULL,
    device_id  INTEGER,
    detail     TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_remote_audit_created_at ON remote_audit (created_at);
