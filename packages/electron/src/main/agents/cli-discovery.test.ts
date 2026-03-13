import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect, Option } from "effect";

// Mock node modules — exec needs callback signature for promisify(exec) = execAsync
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  exec: vi.fn(),
}));

const mockAccess = vi.fn();
vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    promises: {
      access: (...args: any[]) => mockAccess(...args),
    },
  },
  existsSync: vi.fn(),
  promises: {
    access: (...args: any[]) => mockAccess(...args),
  },
}));

vi.mock("../db/database");

import { exec } from "node:child_process";
import { discoverClaudeCli, getResolvedPath } from "./cli-discovery";
import { getDatabase } from "../db/database";
import { createMockDb } from "../test-utils";
import { CliNotFoundError } from "../effect/errors";

const mockExec = vi.mocked(exec);
const mockGetDatabase = vi.mocked(getDatabase);

/**
 * Helper: make the `exec` mock call its callback with an error.
 */
function mockExecError(message = "not found") {
  mockExec.mockImplementation((_cmd: any, _opts: any, cb: any) => {
    const err = new Error(message);
    if (typeof _opts === "function") {
      _opts(err, { stdout: "", stderr: "" });
    } else if (typeof cb === "function") {
      cb(err, { stdout: "", stderr: "" });
    }
    return {} as any;
  });
}

describe("discoverClaudeCli", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    mockGetDatabase.mockReturnValue(db as any);
    vi.clearAllMocks();
    // By default, all fs.promises.access calls reject (file not found)
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    // By default, exec calls error (not found)
    mockExecError();
  });

  it("fails with CliNotFoundError if claude is not found anywhere", async () => {
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });

    const result = await Effect.runPromise(discoverClaudeCli().pipe(Effect.option));
    expect(Option.isNone(result)).toBe(true);
  });

  it("includes COMMON_LOCATIONS in CliNotFoundError.searchedPaths", async () => {
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });

    let caughtError: CliNotFoundError | null = null;
    await Effect.runPromise(
      discoverClaudeCli().pipe(
        Effect.catchTag("CliNotFoundError", (e) => {
          caughtError = e;
          return Effect.succeed(null);
        }),
      ),
    );
    expect(caughtError).toBeInstanceOf(CliNotFoundError);
    expect(Array.isArray(caughtError!.searchedPaths)).toBe(true);
  });

  it("returns configured path from settings first", async () => {
    const configuredPath = "/custom/path/claude";
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ value: configuredPath }) });
    mockAccess.mockImplementation((p: string) =>
      p === configuredPath ? Promise.resolve() : Promise.reject(new Error("ENOENT")),
    );

    const result = await Effect.runPromise(discoverClaudeCli());

    expect(result).toEqual({ path: configuredPath, source: "settings" });
  });

  it("falls back to shell PATH when settings not configured", async () => {
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    const shellPath = "/usr/local/bin/claude";
    // exec mock: `which claude` returns the shell path
    mockExec.mockImplementation((cmd: any, _opts: any, cb: any) => {
      const cmdStr = cmd as string;
      if (cmdStr.includes("which claude")) {
        const callback = typeof _opts === "function" ? _opts : cb;
        callback(null, { stdout: shellPath, stderr: "" });
      } else {
        const callback = typeof _opts === "function" ? _opts : cb;
        callback(new Error("not found"), { stdout: "", stderr: "" });
      }
      return {} as any;
    });
    mockAccess.mockImplementation((p: string) =>
      p === shellPath ? Promise.resolve() : Promise.reject(new Error("ENOENT")),
    );

    const result = await Effect.runPromise(discoverClaudeCli());

    expect(result).toEqual({ path: shellPath, source: "shell-path" });
  });

  it("falls back to process PATH when shell PATH fails", async () => {
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    mockExecError();

    const processPath = "/usr/bin/claude";
    const origPath = process.env.PATH;
    process.env.PATH = "/usr/bin:/usr/local/bin";
    mockAccess.mockImplementation((p: string) =>
      p === processPath ? Promise.resolve() : Promise.reject(new Error("ENOENT")),
    );

    const result = await Effect.runPromise(discoverClaudeCli());
    process.env.PATH = origPath;

    expect(result).toEqual({ path: processPath, source: "process-path" });
  });

  it("falls back to common locations last", async () => {
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    mockExecError();
    const origPath = process.env.PATH;
    process.env.PATH = "";

    const commonPath = "/usr/local/bin/claude";
    mockAccess.mockImplementation((p: string) =>
      p === commonPath ? Promise.resolve() : Promise.reject(new Error("ENOENT")),
    );

    const result = await Effect.runPromise(discoverClaudeCli());
    process.env.PATH = origPath;

    expect(result.source).toBe("common-location");
    expect(result.path).toBe(commonPath);
  });

  it("skips configured path if file does not exist", async () => {
    db.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ value: "/nonexistent/claude" }) });
    // All access calls reject
    mockAccess.mockRejectedValue(new Error("ENOENT"));

    const result = await Effect.runPromise(discoverClaudeCli().pipe(Effect.option));

    // Since shell/process/common also fail, should be None
    expect(Option.isNone(result)).toBe(true);
  });
});

describe("getResolvedPath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns shell PATH from exec", async () => {
    mockExec.mockImplementation((_cmd: any, _opts: any, cb: any) => {
      const callback = typeof _opts === "function" ? _opts : cb;
      callback(null, { stdout: "/usr/local/bin:/usr/bin:/bin", stderr: "" });
      return {} as any;
    });

    const result = await Effect.runPromise(getResolvedPath());
    expect(result).toBe("/usr/local/bin:/usr/bin:/bin");
  });

  it("falls back to process PATH on error", async () => {
    mockExec.mockImplementation((_cmd: any, _opts: any, cb: any) => {
      const callback = typeof _opts === "function" ? _opts : cb;
      callback(new Error("shell not found"), { stdout: "", stderr: "" });
      return {} as any;
    });
    const origPath = process.env.PATH;
    process.env.PATH = "/fallback/path";

    const result = await Effect.runPromise(getResolvedPath());
    process.env.PATH = origPath;

    expect(result).toBe("/fallback/path");
  });
});
