import Database from "better-sqlite3";
import { app } from "electron";
import path from "node:path";
import { runMigrations } from "./migrations";

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  const dbPath = path.join(app.getPath("userData"), "productdevr.db");
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");

  runMigrations(db);

  // Resume any in-progress features after DB is ready (deferred to avoid circular imports)
  void (async () => {
    try {
      const { processNextPhase } = await import("../agents/execute-agent");
      const { resolveAgentCwd } = await import("../agents/resolve-cwd");
      const inProgress = db!.prepare("SELECT id, project_id FROM features WHERE status = 'in-progress'").all() as { id: number; project_id: number }[];
      for (const feat of inProgress) {
        try {
          const { cwd, worktreePath } = resolveAgentCwd(feat.id, feat.project_id);
          processNextPhase({ featureId: feat.id, projectId: feat.project_id, cwd, worktreePath });
        } catch { /* individual feature recovery failure is ok */ }
      }
    } catch {
      // Silently ignore — agent module may not be loaded yet
    }
  })();

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
