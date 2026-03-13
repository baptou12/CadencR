import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";

/**
 * Migration tests use a real in-memory SQLite database since they are schema-critical.
 * better-sqlite3 is externalized in the vite config but available in the test node env.
 */

function createInMemoryDb(): Database.Database {
  return new Database(":memory:");
}

describe("runMigrations", () => {
  it("creates the migrations tracking table", () => {
    const db = createInMemoryDb();
    runMigrations(db);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("migrations");
    db.close();
  });

  it("runs all migrations without errors", () => {
    const db = createInMemoryDb();
    expect(() => runMigrations(db)).not.toThrow();
    db.close();
  });

  it("records all migrations in the tracking table", () => {
    const db = createInMemoryDb();
    runMigrations(db);
    const rows = db.prepare("SELECT version FROM migrations ORDER BY version ASC").all() as Array<{ version: number }>;
    expect(rows.length).toBeGreaterThanOrEqual(13);
    // Versions should be sequential starting at 1
    expect(rows[0].version).toBe(1);
  });

  it("is idempotent — running twice does not throw or duplicate rows", () => {
    const db = createInMemoryDb();
    runMigrations(db);
    const countAfterFirst = (db.prepare("SELECT COUNT(*) as count FROM migrations").get() as { count: number }).count;
    runMigrations(db);
    const countAfterSecond = (db.prepare("SELECT COUNT(*) as count FROM migrations").get() as { count: number }).count;
    expect(countAfterFirst).toBe(countAfterSecond);
    db.close();
  });

  it("creates the settings table (migration 1)", () => {
    const db = createInMemoryDb();
    runMigrations(db);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("settings");
    db.close();
  });

  it("creates the projects table (migration 2)", () => {
    const db = createInMemoryDb();
    runMigrations(db);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("projects");
    db.close();
  });

  it("creates the features table (migration 3)", () => {
    const db = createInMemoryDb();
    runMigrations(db);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='features'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("features");
    db.close();
  });

  it("creates the agent_sessions table (migration 6)", () => {
    const db = createInMemoryDb();
    runMigrations(db);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_sessions'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("agent_sessions");
    db.close();
  });

  it("creates the diff_comments table (migration 10)", () => {
    const db = createInMemoryDb();
    runMigrations(db);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='diff_comments'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("diff_comments");
    db.close();
  });

  it("features table has 'type' column after migration 13", () => {
    const db = createInMemoryDb();
    runMigrations(db);
    const columns = db.pragma("table_info(features)") as Array<{ name: string }>;
    const names = columns.map((c) => c.name);
    expect(names).toContain("type");
    db.close();
  });

  it("applies migrations in order (versions are sequential)", () => {
    const db = createInMemoryDb();
    runMigrations(db);
    const rows = db
      .prepare("SELECT version FROM migrations ORDER BY version ASC")
      .all() as Array<{ version: number }>;
    for (let i = 0; i < rows.length - 1; i++) {
      expect(rows[i + 1].version).toBeGreaterThan(rows[i].version);
    }
    db.close();
  });
});
