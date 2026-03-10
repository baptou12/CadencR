import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { Database, DatabaseLive } from "./Database.js";
import { DatabaseError } from "../errors.js";

vi.mock("../../db/database");
import { getDatabase } from "../../db/database.js";

const mockGetDatabase = vi.mocked(getDatabase);

/** Run an effect that requires Database, providing DatabaseLive */
function runDb<T>(eff: Effect.Effect<T, DatabaseError, Database>): T {
  return Effect.runSync(Effect.provide(eff, DatabaseLive));
}

describe("Database service — DatabaseLive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // queryOne
  // ---------------------------------------------------------------------------
  describe("queryOne", () => {
    it("returns the row when found", () => {
      const row = { id: 1, name: "test" };
      const stmt = { get: vi.fn().mockReturnValue(row) };
      mockGetDatabase.mockReturnValue({ prepare: vi.fn().mockReturnValue(stmt) } as any);

      const result = runDb(
        Effect.flatMap(Database, (db) =>
          db.queryOne<{ id: number; name: string }>("SELECT * FROM test WHERE id = ?", 1),
        ),
      );

      expect(result).toEqual({ id: 1, name: "test" });
    });

    it("returns null when no row is found", () => {
      const stmt = { get: vi.fn().mockReturnValue(undefined) };
      mockGetDatabase.mockReturnValue({ prepare: vi.fn().mockReturnValue(stmt) } as any);

      const result = runDb(
        Effect.flatMap(Database, (db) =>
          db.queryOne<{ id: number }>("SELECT * FROM test WHERE id = ?", 999),
        ),
      );

      expect(result).toBeNull();
    });

    it("throws DatabaseError when SQL execution fails", () => {
      const stmt = {
        get: vi.fn().mockImplementation(() => {
          throw new Error("no such table: test");
        }),
      };
      mockGetDatabase.mockReturnValue({ prepare: vi.fn().mockReturnValue(stmt) } as any);

      let thrown: unknown;
      try {
        runDb(
          Effect.flatMap(Database, (db) => db.queryOne("SELECT * FROM nonexistent", 1)),
        );
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // queryAll
  // ---------------------------------------------------------------------------
  describe("queryAll", () => {
    it("returns an array of rows", () => {
      const rows = [{ id: 1 }, { id: 2 }];
      const stmt = { all: vi.fn().mockReturnValue(rows) };
      mockGetDatabase.mockReturnValue({ prepare: vi.fn().mockReturnValue(stmt) } as any);

      const result = runDb(
        Effect.flatMap(Database, (db) => db.queryAll<{ id: number }>("SELECT id FROM test")),
      );

      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it("returns an empty array when no rows match", () => {
      const stmt = { all: vi.fn().mockReturnValue([]) };
      mockGetDatabase.mockReturnValue({ prepare: vi.fn().mockReturnValue(stmt) } as any);

      const result = runDb(
        Effect.flatMap(Database, (db) =>
          db.queryAll<{ id: number }>("SELECT id FROM test WHERE id = ?", 9999),
        ),
      );

      expect(result).toEqual([]);
    });

    it("throws DatabaseError when SQL execution fails", () => {
      const stmt = {
        all: vi.fn().mockImplementation(() => {
          throw new Error("syntax error");
        }),
      };
      mockGetDatabase.mockReturnValue({ prepare: vi.fn().mockReturnValue(stmt) } as any);

      let thrown: unknown;
      try {
        runDb(
          Effect.flatMap(Database, (db) => db.queryAll("INVALID SQL")),
        );
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // execute
  // ---------------------------------------------------------------------------
  describe("execute", () => {
    it("returns changes and lastInsertRowid on success", () => {
      const stmt = {
        run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 42 }),
      };
      mockGetDatabase.mockReturnValue({ prepare: vi.fn().mockReturnValue(stmt) } as any);

      const result = runDb(
        Database.execute("INSERT INTO test (name) VALUES (?)", "hello"),
      );

      expect(result).toEqual({ changes: 1, lastInsertRowid: 42 });
    });

    it("returns 0 changes when nothing is updated", () => {
      const stmt = {
        run: vi.fn().mockReturnValue({ changes: 0, lastInsertRowid: 0 }),
      };
      mockGetDatabase.mockReturnValue({ prepare: vi.fn().mockReturnValue(stmt) } as any);

      const result = runDb(
        Database.execute("UPDATE test SET name = ? WHERE id = ?", "new", 9999),
      );

      expect(result).toEqual({ changes: 0, lastInsertRowid: 0 });
    });

    it("throws DatabaseError when execute fails", () => {
      const stmt = {
        run: vi.fn().mockImplementation(() => {
          throw new Error("UNIQUE constraint failed");
        }),
      };
      mockGetDatabase.mockReturnValue({ prepare: vi.fn().mockReturnValue(stmt) } as any);

      let thrown: unknown;
      try {
        runDb(
          Database.execute("INSERT INTO test (id) VALUES (?)", 1),
        );
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeDefined();
    });
  });
});
