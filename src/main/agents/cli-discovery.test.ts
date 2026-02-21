import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node modules
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));
vi.mock("node:fs", () => ({
  default: { existsSync: vi.fn() },
  existsSync: vi.fn(),
}));
vi.mock("../db/database");

import { execSync } from "node:child_process";
import fs from "node:fs";
import { discoverClaudeCli, getResolvedPath } from "./cli-discovery";
import { getDatabase } from "../db/database";
import { createMockDb } from "../test-utils";

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockGetDatabase = vi.mocked(getDatabase);

describe("discoverClaudeCli", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    mockGetDatabase.mockReturnValue(db as any);
    vi.clearAllMocks();
    // By default, no files exist
    mockExistsSync.mockReturnValue(false);
    // By default, execSync throws (not found)
    mockExecSync.mockImplementation(() => { throw new Error("not found"); });
  });

  it("returns null if claude is not found anywhere", () => {
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });

    const result = discoverClaudeCli();
    expect(result).toBeNull();
  });

  it("returns configured path from settings first", () => {
    const configuredPath = "/custom/path/claude";
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ value: configuredPath }) });
    mockExistsSync.mockImplementation((p) => p === configuredPath);

    const result = discoverClaudeCli();

    expect(result).toEqual({ path: configuredPath, source: "settings" });
  });

  it("falls back to shell PATH when settings not configured", () => {
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    const shellPath = "/usr/local/bin/claude";
    mockExecSync.mockImplementation((cmd: unknown) => {
      const cmdStr = cmd as string;
      if (cmdStr.includes("which claude")) return shellPath as any;
      throw new Error("not found");
    });
    mockExistsSync.mockImplementation((p) => p === shellPath);

    const result = discoverClaudeCli();

    expect(result).toEqual({ path: shellPath, source: "shell-path" });
  });

  it("falls back to process PATH when shell PATH fails", () => {
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    mockExecSync.mockImplementation(() => { throw new Error("not found"); });

    const processPath = "/usr/bin/claude";
    const origPath = process.env.PATH;
    process.env.PATH = "/usr/bin:/usr/local/bin";
    mockExistsSync.mockImplementation((p) => p === processPath);

    const result = discoverClaudeCli();
    process.env.PATH = origPath;

    expect(result).toEqual({ path: processPath, source: "process-path" });
  });

  it("falls back to common locations last", () => {
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    mockExecSync.mockImplementation(() => { throw new Error(); });
    process.env.PATH = "";

    const commonPath = "/usr/local/bin/claude";
    mockExistsSync.mockImplementation((p) => p === commonPath);

    const result = discoverClaudeCli();

    expect(result?.source).toBe("common-location");
    expect(result?.path).toBe(commonPath);
  });

  it("skips configured path if file does not exist", () => {
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ value: "/nonexistent/claude" }) });
    mockExistsSync.mockReturnValue(false);

    const result = discoverClaudeCli();

    // Since shell/process/common also fail, should be null
    expect(result).toBeNull();
  });
});

describe("getResolvedPath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns shell PATH from execSync", () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const cmdStr = cmd as string;
      if (cmdStr.includes("echo $PATH")) return "/usr/local/bin:/usr/bin:/bin" as any;
      throw new Error("not found");
    });

    const result = getResolvedPath();
    expect(result).toBe("/usr/local/bin:/usr/bin:/bin");
  });

  it("falls back to process PATH on error", () => {
    mockExecSync.mockImplementation(() => { throw new Error("shell not found"); });
    const origPath = process.env.PATH;
    process.env.PATH = "/fallback/path";

    const result = getResolvedPath();
    process.env.PATH = origPath;

    expect(result).toBe("/fallback/path");
  });
});
