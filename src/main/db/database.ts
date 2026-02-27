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

  // Schedule workflow resumption after DB is ready (deferred to avoid circular imports)
  queueMicrotask(() => {
    try {
      const { resumeWorkflows } = require("../agents/workflow-orchestrator");
      resumeWorkflows();
    } catch {
      // Silently ignore — orchestrator may not be loaded yet
    }
  });

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
