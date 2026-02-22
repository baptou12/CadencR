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
  {
    version: 13,
    description: "Add type column to features table",
    up: (db) => {
      db.exec("ALTER TABLE features ADD COLUMN type TEXT NOT NULL DEFAULT 'feature'");
    },
  },
  {
    version: 14,
    description: "Add run_id and phase_id columns to agent_sessions",
    up: (db) => {
      db.exec("ALTER TABLE agent_sessions ADD COLUMN run_id INTEGER");
      db.exec("ALTER TABLE agent_sessions ADD COLUMN phase_id INTEGER");
    },
  },
  {
    version: 15,
    description: "Remove interrupted status — replaced by paused",
    up: (db) => {
      db.exec("DELETE FROM agent_sessions WHERE status = 'interrupted'");
    },
  },
  {
    version: 16,
    description: "Add subprocess_id column to agent_sessions",
    up: (db) => {
      db.exec("ALTER TABLE agent_sessions ADD COLUMN subprocess_id TEXT");
      db.exec("CREATE INDEX idx_agent_sessions_subprocess_id ON agent_sessions(subprocess_id)");
    },
  },
  {
    version: 17,
    description: "Add implementation_notes and deviations columns to phases table",
    up: (db) => {
      db.exec("ALTER TABLE phases ADD COLUMN implementation_notes TEXT");
      db.exec("ALTER TABLE phases ADD COLUMN deviations TEXT");
    },
  },
  {
    version: 18,
    description: "Migrate auto_commit to agent_autonomy setting",
    up: (db) => {
      // Set global default
      db.exec(`
        INSERT OR IGNORE INTO settings (key, value) VALUES ('agent_autonomy', '1')
      `);

      // Migrate project_settings: auto_commit=true -> agent_autonomy=3, else 1
      db.exec(`
        INSERT OR IGNORE INTO project_settings (project_id, key, value)
        SELECT project_id, 'agent_autonomy', CASE WHEN value = 'true' THEN '3' ELSE '1' END
        FROM project_settings
        WHERE key = 'auto_commit'
      `);

      // Migrate feature_settings: auto_commit=true -> agent_autonomy=3, else 1
      db.exec(`
        INSERT OR IGNORE INTO feature_settings (feature_id, key, value)
        SELECT feature_id, 'agent_autonomy', CASE WHEN value = 'true' THEN '3' ELSE '1' END
        FROM feature_settings
        WHERE key = 'auto_commit'
      `);
    },
  },
  {
    version: 19,
    description: "Remove deprecated auto_commit rows",
    up: (db) => {
      db.exec(`DELETE FROM project_settings WHERE key = 'auto_commit'`);
      db.exec(`DELETE FROM feature_settings WHERE key = 'auto_commit'`);
    },
  },
  {
    version: 20,
    description: "Add model column to agent_sessions",
    up: (db) => {
      db.exec("ALTER TABLE agent_sessions ADD COLUMN model TEXT");
    },
  },
  {
    version: 21,
    description: "Add pending_questions and has_file_changes to agent_sessions",
    up: (db) => {
      db.exec("ALTER TABLE agent_sessions ADD COLUMN pending_questions TEXT");
      db.exec("ALTER TABLE agent_sessions ADD COLUMN has_file_changes INTEGER DEFAULT 0");
      db.exec("CREATE INDEX IF NOT EXISTS idx_agent_sessions_feature_status ON agent_sessions(feature_id, status)");
    },
  },
  {
    version: 22,
    description: "Add tool_use_id and parent_tool_use_id to agent_messages for sub-agent nesting",
    up: (db) => {
      db.exec("ALTER TABLE agent_messages ADD COLUMN tool_use_id TEXT");
      db.exec("ALTER TABLE agent_messages ADD COLUMN parent_tool_use_id TEXT");
    },
  },
  {
    version: 23,
    description: "Add permission_mode column to agent_sessions",
    up: (db) => {
      db.exec("ALTER TABLE agent_sessions ADD COLUMN permission_mode TEXT DEFAULT 'bypassPermissions'");
    },
  },
  {
    version: 24,
    description: "Add pending_plan_approval column to agent_sessions",
    up: (db) => {
      db.exec("ALTER TABLE agent_sessions ADD COLUMN pending_plan_approval TEXT");
    },
  },
  {
    version: 25,
    description: "Add context usage tracking columns to agent_sessions",
    up: (db) => {
      db.exec("ALTER TABLE agent_sessions ADD COLUMN input_tokens INTEGER DEFAULT 0");
      db.exec("ALTER TABLE agent_sessions ADD COLUMN output_tokens INTEGER DEFAULT 0");
      db.exec("ALTER TABLE agent_sessions ADD COLUMN context_window INTEGER DEFAULT 200000");
      db.exec("ALTER TABLE agent_sessions ADD COLUMN was_compacted INTEGER DEFAULT 0");
    },
  },
  {
    version: 26,
    description: "Add pending_permission column to agent_sessions",
    up: (db) => {
      db.exec("ALTER TABLE agent_sessions ADD COLUMN pending_permission TEXT");
    },
  },
  {
    version: 27,
    description: "Change permission_mode default from bypassPermissions to acceptEdits",
    up: (db) => {
      // Update any existing rows that still have the old default
      db.exec("UPDATE agent_sessions SET permission_mode = 'acceptEdits' WHERE permission_mode = 'bypassPermissions'");
    },
  },
  {
    version: 28,
    description: "Add phase_type column to phases",
    up: (db) => {
      db.exec("ALTER TABLE phases ADD COLUMN phase_type TEXT NOT NULL DEFAULT 'value'");
    },
  },
  {
    version: 29,
    description: "Add real columns for model/autonomy settings to projects and features",
    up: (db) => {
      // Add columns to projects
      const modelCols = ["model_plan", "model_brainstorm", "model_execute", "model_risk", "model_review", "model_session", "model_qa"];
      for (const col of modelCols) {
        db.exec(`ALTER TABLE projects ADD COLUMN ${col} TEXT`);
      }
      db.exec("ALTER TABLE projects ADD COLUMN agent_autonomy TEXT");
      db.exec("ALTER TABLE projects ADD COLUMN branch_prefix TEXT");
      db.exec("ALTER TABLE projects ADD COLUMN qa_prompt TEXT");

      // Add columns to features
      for (const col of modelCols) {
        db.exec(`ALTER TABLE features ADD COLUMN ${col} TEXT`);
      }
      db.exec("ALTER TABLE features ADD COLUMN agent_autonomy TEXT");

      // Migrate project_settings EAV data to real columns
      const projectKeys = [...modelCols, "agent_autonomy", "branch_prefix", "qa_prompt"];
      for (const key of projectKeys) {
        db.exec(`
          UPDATE projects SET ${key} = (
            SELECT value FROM project_settings WHERE project_settings.project_id = projects.id AND project_settings.key = '${key}'
          )
          WHERE EXISTS (
            SELECT 1 FROM project_settings WHERE project_settings.project_id = projects.id AND project_settings.key = '${key}'
          )
        `);
        db.exec(`DELETE FROM project_settings WHERE key = '${key}'`);
      }

      // Migrate feature_settings EAV data to real columns
      const featureKeys = [...modelCols, "agent_autonomy"];
      for (const key of featureKeys) {
        db.exec(`
          UPDATE features SET ${key} = (
            SELECT value FROM feature_settings WHERE feature_settings.feature_id = features.id AND feature_settings.key = '${key}'
          )
          WHERE EXISTS (
            SELECT 1 FROM feature_settings WHERE feature_settings.feature_id = features.id AND feature_settings.key = '${key}'
          )
        `);
        db.exec(`DELETE FROM feature_settings WHERE key = '${key}'`);
      }
    },
  },
  {
    version: 30,
    description: "Add prompt_history table and draft_prompt column to agent_sessions",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS prompt_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_prompt_history_project ON prompt_history(project_id, created_at DESC);
      `);
      db.exec("ALTER TABLE agent_sessions ADD COLUMN draft_prompt TEXT DEFAULT NULL");
    },
  },
  {
    version: 31,
    description: "Create diff_viewed_files table for tracking viewed files in diff viewer",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS diff_viewed_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          feature_id INTEGER NOT NULL,
          file_path TEXT NOT NULL,
          blob_sha TEXT NOT NULL,
          viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (feature_id) REFERENCES features(id),
          UNIQUE(feature_id, file_path)
        )
      `);
    },
  },
  {
    version: 32,
    description: "Add model column to agent_messages for per-message model tracking",
    up: (db) => {
      db.exec("ALTER TABLE agent_messages ADD COLUMN model TEXT DEFAULT NULL");
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
