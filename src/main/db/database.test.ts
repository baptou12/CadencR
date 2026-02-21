import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock better-sqlite3 before importing the module under test
const mockDb = {
  pragma: vi.fn().mockReturnValue([]),
  exec: vi.fn(),
  prepare: vi.fn().mockReturnValue({
    get: vi.fn().mockReturnValue({ version: null }),
    all: vi.fn().mockReturnValue([]),
    run: vi.fn(),
  }),
  transaction: vi.fn().mockImplementation((fn: () => void) => fn),
  close: vi.fn(),
};

// Use a class so it works with `new Database(...)`
const DatabaseConstructor = vi.fn().mockImplementation(function () {
  return mockDb;
});

vi.mock("better-sqlite3", () => ({ default: DatabaseConstructor }));

// Mock migrations to avoid running real SQL in unit test
vi.mock("./migrations", () => ({
  runMigrations: vi.fn(),
}));

describe("database", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module to clear singleton between tests
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("creates a new database on first call", async () => {
    const { getDatabase } = await import("./database");
    const db = getDatabase();
    expect(db).toBeDefined();
    expect(DatabaseConstructor).toHaveBeenCalledTimes(1);
  });

  it("returns the same instance on subsequent calls (singleton)", async () => {
    const { getDatabase } = await import("./database");
    const db1 = getDatabase();
    const db2 = getDatabase();
    expect(db1).toBe(db2);
    expect(DatabaseConstructor).toHaveBeenCalledTimes(1);
  });

  it("enables WAL mode via pragma", async () => {
    const { getDatabase } = await import("./database");
    getDatabase();
    expect(mockDb.pragma).toHaveBeenCalledWith("journal_mode = WAL");
  });

  it("calls runMigrations on first init", async () => {
    const { runMigrations } = await import("./migrations");
    const { getDatabase } = await import("./database");
    getDatabase();
    expect(runMigrations).toHaveBeenCalledTimes(1);
  });

  it("closeDatabase resets the singleton", async () => {
    const { getDatabase, closeDatabase } = await import("./database");
    getDatabase();
    closeDatabase();
    expect(mockDb.close).toHaveBeenCalledTimes(1);
    // After close, a second call creates a new instance
    getDatabase();
    expect(DatabaseConstructor).toHaveBeenCalledTimes(2);
  });

  it("uses the electron userData path for the db file", async () => {
    const { getDatabase } = await import("./database");
    getDatabase();
    const callArg = DatabaseConstructor.mock.calls[0][0] as string;
    expect(callArg).toContain("productdevr.db");
    expect(callArg).toContain("userData");
  });
});
