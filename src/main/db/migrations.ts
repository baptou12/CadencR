import type Database from "better-sqlite3";

interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    description: "Create settings table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
    },
  },
];

export function runMigrations(db: Database.Database): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const currentVersion = db
    .prepare("SELECT MAX(version) as version FROM migrations")
    .get() as { version: number | null };

  const appliedVersion = currentVersion?.version ?? 0;

  const pending = migrations.filter((m) => m.version > appliedVersion);

  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db);
      db.prepare(
        "INSERT INTO migrations (version, description) VALUES (?, ?)"
      ).run(migration.version, migration.description);
    })();
  }
}
