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
  {
    version: 2,
    description: "Create projects table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    },
  },
  {
    version: 3,
    description: "Create features table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS features (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (project_id) REFERENCES projects(id)
        )
      `);
    },
  },
  {
    version: 4,
    description: "Create plans table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS plans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          feature_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          raw_markdown TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (feature_id) REFERENCES features(id)
        )
      `);
    },
  },
  {
    version: 5,
    description: "Create phases table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS phases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          plan_id INTEGER NOT NULL,
          step_number INTEGER NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          complexity INTEGER,
          commit_message TEXT,
          prompt TEXT,
          order_index INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (plan_id) REFERENCES plans(id)
        )
      `);
    },
  },
  {
    version: 6,
    description: "Create agent_sessions table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          feature_id INTEGER NOT NULL,
          agent_type TEXT NOT NULL,
          claude_session_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          started_at TEXT,
          ended_at TEXT,
          FOREIGN KEY (feature_id) REFERENCES features(id)
        )
      `);
    },
  },
  {
    version: 7,
    description: "Create agent_messages table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          message_type TEXT NOT NULL DEFAULT 'text',
          tool_name TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (session_id) REFERENCES agent_sessions(id)
        )
      `);
    },
  },
  {
    version: 8,
    description: "Create project_settings table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id),
          UNIQUE(project_id, key)
        )
      `);
    },
  },
  {
    version: 9,
    description: "Create feature_settings table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS feature_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          feature_id INTEGER NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          FOREIGN KEY (feature_id) REFERENCES features(id),
          UNIQUE(feature_id, key)
        )
      `);
    },
  },
  {
    version: 10,
    description: "Create diff_comments table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS diff_comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          feature_id INTEGER NOT NULL,
          file_path TEXT NOT NULL,
          line_number INTEGER NOT NULL,
          side TEXT NOT NULL CHECK (side IN ('old', 'new')),
          content TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'resolved')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (feature_id) REFERENCES features(id)
        )
      `);
    },
  },
  {
    version: 11,
    description: "Ensure phases table has prompt column",
    up: (db) => {
      const columns = db.pragma("table_info(phases)") as Array<{ name: string }>;
      if (!columns.some((c) => c.name === "prompt")) {
        db.exec("ALTER TABLE phases ADD COLUMN prompt TEXT");
      }
    },
  },
  {
    version: 12,
    description: "Add plan-level context columns to plans table",
    up: (db) => {
      db.exec("ALTER TABLE plans ADD COLUMN summary TEXT");
      db.exec("ALTER TABLE plans ADD COLUMN context TEXT");
      db.exec("ALTER TABLE plans ADD COLUMN clarifications TEXT");
      db.exec("ALTER TABLE plans ADD COLUMN completion_conditions TEXT");
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

  const currentVersion = db.prepare("SELECT MAX(version) as version FROM migrations").get() as {
    version: number | null;
  };

  const appliedVersion = currentVersion?.version ?? 0;

  const pending = migrations.filter((m) => m.version > appliedVersion);

  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db);
      db.prepare("INSERT INTO migrations (version, description) VALUES (?, ?)").run(
        migration.version,
        migration.description,
      );
    })();
  }
}
