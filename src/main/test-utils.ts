import { vi } from "vitest";

/**
 * Creates a mock better-sqlite3 Statement with jest.fn() stubs for get/all/run.
 */
export function createMockStatement() {
  return {
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
    run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
  };
}

/**
 * Creates a mock better-sqlite3 Database with stubs for common methods.
 * The `prepare()` method returns a new mock statement each call (or a fixed one if provided).
 */
export function createMockDb() {
  const mockDb = {
    prepare: vi.fn().mockImplementation(() => createMockStatement()),
    exec: vi.fn(),
    pragma: vi.fn().mockReturnValue([]),
    transaction: vi.fn().mockImplementation((fn: () => void) => fn),
    close: vi.fn(),
  };
  return mockDb;
}

export type MockDb = ReturnType<typeof createMockDb>;
export type MockStatement = ReturnType<typeof createMockStatement>;
