/**
 * Tests for the permissions module.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Mock fs and os
vi.mock("node:fs");
vi.mock("node:os");

// Import after mocks
import {
  loadAllowedPatterns,
  resolvePermission,
  appendToSettingsLocal,
} from "./permissions";

const WORKTREE = "/home/user/project/worktree";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(os.homedir).mockReturnValue("/home/user");
});

// ---------------------------------------------------------------------------
// loadAllowedPatterns
// ---------------------------------------------------------------------------

describe("loadAllowedPatterns", () => {
  it("returns empty set when no settings files exist", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const patterns = loadAllowedPatterns(WORKTREE);
    expect(patterns.size).toBe(0);
  });

  it("loads patterns from global settings.json", () => {
    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      if (String(filePath).includes(".claude/settings.json") && String(filePath).startsWith("/home/user")) {
        return JSON.stringify({
          permissions: { allow: ["Read(**)", "Write(**)"] },
        });
      }
      throw new Error("ENOENT");
    });
    const patterns = loadAllowedPatterns(WORKTREE);
    expect(patterns.has("Read(**)")).toBe(true);
    expect(patterns.has("Write(**)")).toBe(true);
  });

  it("loads patterns from project settings.json", () => {
    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      const fp = String(filePath);
      if (fp === path.join(WORKTREE, ".claude", "settings.json")) {
        return JSON.stringify({
          permissions: { allow: ["Bash(npm:*)"] },
        });
      }
      throw new Error("ENOENT");
    });
    const patterns = loadAllowedPatterns(WORKTREE);
    expect(patterns.has("Bash(npm:*)")).toBe(true);
  });

  it("loads patterns from settings.local.json", () => {
    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      const fp = String(filePath);
      if (fp === path.join(WORKTREE, ".claude", "settings.local.json")) {
        return JSON.stringify({
          permissions: { allow: ["Read(/some/path)"] },
        });
      }
      throw new Error("ENOENT");
    });
    const patterns = loadAllowedPatterns(WORKTREE);
    expect(patterns.has("Read(/some/path)")).toBe(true);
  });

  it("merges patterns from all three sources without duplicates", () => {
    const settingsJson = JSON.stringify({ permissions: { allow: ["Read(**)", "Bash(npm:*)"] } });
    vi.mocked(fs.readFileSync).mockReturnValue(settingsJson as any);
    const patterns = loadAllowedPatterns(WORKTREE);
    // Three files all return same content, but Set deduplicates
    expect(patterns.size).toBe(2);
    expect(patterns.has("Read(**)")).toBe(true);
    expect(patterns.has("Bash(npm:*)")).toBe(true);
  });

  it("silently skips files with invalid JSON", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("not-valid-json" as any);
    const patterns = loadAllowedPatterns(WORKTREE);
    expect(patterns.size).toBe(0);
  });

  it("skips files where permissions.allow is not an array", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ permissions: { allow: "not-an-array" } }) as any
    );
    const patterns = loadAllowedPatterns(WORKTREE);
    expect(patterns.size).toBe(0);
  });

  it("ignores non-string entries in allow array", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ permissions: { allow: [42, null, "Read(**)"] } }) as any
    );
    const patterns = loadAllowedPatterns(WORKTREE);
    expect(patterns.size).toBe(1);
    expect(patterns.has("Read(**)")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolvePermission
// ---------------------------------------------------------------------------

describe("resolvePermission", () => {
  const cache = new Set<string>();

  beforeEach(() => cache.clear());

  describe("always-allowed tools", () => {
    it("allows WebSearch", () => {
      expect(resolvePermission("WebSearch", {}, WORKTREE, cache)).toBe("allow");
    });

    it("allows WebFetch", () => {
      expect(resolvePermission("WebFetch", {}, WORKTREE, cache)).toBe("allow");
    });

    it("allows AskUserQuestion", () => {
      expect(resolvePermission("AskUserQuestion", {}, WORKTREE, cache)).toBe("allow");
    });

    it("allows ExitPlanMode", () => {
      expect(resolvePermission("ExitPlanMode", {}, WORKTREE, cache)).toBe("allow");
    });

    it("allows TodoRead", () => {
      expect(resolvePermission("TodoRead", {}, WORKTREE, cache)).toBe("allow");
    });

    it("allows TodoWrite", () => {
      expect(resolvePermission("TodoWrite", {}, WORKTREE, cache)).toBe("allow");
    });
  });

  describe("MCP tools", () => {
    it("auto-allows mcp__-prefixed tools", () => {
      expect(resolvePermission("mcp__myserver__my_tool", { arg: "value" }, WORKTREE, cache)).toBe("allow");
    });
  });

  describe("Read/Write/Edit within worktree", () => {
    it("allows Read within the worktree", () => {
      const result = resolvePermission(
        "Read",
        { file_path: `${WORKTREE}/src/index.ts` },
        WORKTREE,
        cache,
      );
      expect(result).toBe("allow");
    });

    it("allows Write within the worktree", () => {
      const result = resolvePermission(
        "Write",
        { file_path: `${WORKTREE}/src/new.ts` },
        WORKTREE,
        cache,
      );
      expect(result).toBe("allow");
    });

    it("allows Edit within the worktree", () => {
      const result = resolvePermission(
        "Edit",
        { file_path: `${WORKTREE}/README.md` },
        WORKTREE,
        cache,
      );
      expect(result).toBe("allow");
    });

    it("allows relative paths that resolve inside the worktree", () => {
      const result = resolvePermission(
        "Read",
        { file_path: "src/index.ts" },
        WORKTREE,
        cache,
      );
      expect(result).toBe("allow");
    });
  });

  describe("Read/Write outside worktree", () => {
    it("prompts for Read outside worktree", () => {
      const result = resolvePermission(
        "Read",
        { file_path: "/etc/passwd" },
        WORKTREE,
        cache,
      );
      expect(result).not.toBe("allow");
      expect(result).toMatchObject({ needs_prompt: true });
    });

    it("includes correct pattern in prompt for outside-worktree Read", () => {
      const result = resolvePermission(
        "Read",
        { file_path: "/etc/passwd" },
        WORKTREE,
        cache,
      );
      expect(result).toMatchObject({ pattern: "Read(/etc/passwd)" });
    });

    it("allows outside-worktree path when pattern is in session cache", () => {
      cache.add("Read(/etc/passwd)");
      const result = resolvePermission(
        "Read",
        { file_path: "/etc/passwd" },
        WORKTREE,
        cache,
      );
      expect(result).toBe("allow");
    });
  });

  describe("/tmp paths", () => {
    it("allows Read of /tmp files", () => {
      const result = resolvePermission(
        "Read",
        { file_path: "/tmp/somefile.txt" },
        WORKTREE,
        cache,
      );
      expect(result).toBe("allow");
    });

    it("allows Write to /tmp", () => {
      const result = resolvePermission(
        "Write",
        { file_path: "/tmp/output.json" },
        WORKTREE,
        cache,
      );
      expect(result).toBe("allow");
    });
  });

  describe(".env file protection", () => {
    it("prompts for .env files even within the worktree", () => {
      const result = resolvePermission(
        "Read",
        { file_path: `${WORKTREE}/.env` },
        WORKTREE,
        cache,
      );
      expect(result).toMatchObject({ needs_prompt: true });
    });

    it("prompts for .env.local files", () => {
      const result = resolvePermission(
        "Read",
        { file_path: `${WORKTREE}/.env.local` },
        WORKTREE,
        cache,
      );
      expect(result).toMatchObject({ needs_prompt: true });
    });

    it("prompts for production.env files", () => {
      const result = resolvePermission(
        "Read",
        { file_path: `${WORKTREE}/production.env` },
        WORKTREE,
        cache,
      );
      expect(result).toMatchObject({ needs_prompt: true });
    });

    it("allows .env file when in session cache", () => {
      const envPath = `${WORKTREE}/.env`;
      cache.add(`Read(${path.resolve(envPath)})`);
      const result = resolvePermission(
        "Read",
        { file_path: envPath },
        WORKTREE,
        cache,
      );
      expect(result).toBe("allow");
    });
  });

  describe("Glob/Grep path tools", () => {
    it("allows Glob within worktree", () => {
      const result = resolvePermission(
        "Glob",
        { path: WORKTREE, pattern: "**/*.ts" },
        WORKTREE,
        cache,
      );
      expect(result).toBe("allow");
    });

    it("prompts for Grep outside worktree", () => {
      const result = resolvePermission(
        "Grep",
        { path: "/etc" },
        WORKTREE,
        cache,
      );
      expect(result).toMatchObject({ needs_prompt: true });
    });
  });

  describe("Bash tool", () => {
    it("allows safe bash commands within worktree", () => {
      const result = resolvePermission(
        "Bash",
        { command: "ls -la" },
        WORKTREE,
        cache,
      );
      expect(result).toBe("allow");
    });

    it("prompts for git push", () => {
      const result = resolvePermission(
        "Bash",
        { command: "git push origin main" },
        WORKTREE,
        cache,
      );
      expect(result).toMatchObject({ needs_prompt: true, pattern: "Bash(git push:*)" });
    });

    it("prompts for rm -rf", () => {
      const result = resolvePermission(
        "Bash",
        { command: "rm -rf node_modules" },
        WORKTREE,
        cache,
      );
      expect(result).toMatchObject({ needs_prompt: true, pattern: "Bash(rm -rf:*)" });
    });

    it("prompts for rm -fr (flags reversed)", () => {
      const result = resolvePermission(
        "Bash",
        { command: "rm -fr somedir" },
        WORKTREE,
        cache,
      );
      expect(result).toMatchObject({ needs_prompt: true });
    });

    it("prompts for git reset --hard", () => {
      const result = resolvePermission(
        "Bash",
        { command: "git reset --hard HEAD" },
        WORKTREE,
        cache,
      );
      expect(result).toMatchObject({ needs_prompt: true, pattern: "Bash(git reset --hard:*)" });
    });

    it("prompts for git clean -f", () => {
      const result = resolvePermission(
        "Bash",
        { command: "git clean -f" },
        WORKTREE,
        cache,
      );
      expect(result).toMatchObject({ needs_prompt: true, pattern: "Bash(git clean -f:*)" });
    });

    it("prompts for git checkout --", () => {
      const result = resolvePermission(
        "Bash",
        { command: "git checkout -- ." },
        WORKTREE,
        cache,
      );
      expect(result).toMatchObject({ needs_prompt: true, pattern: "Bash(git checkout --:*)" });
    });

    it("prompts for sudo rm", () => {
      const result = resolvePermission(
        "Bash",
        { command: "sudo rm /etc/hosts" },
        WORKTREE,
        cache,
      );
      expect(result).toMatchObject({ needs_prompt: true, pattern: "Bash(sudo rm:*)" });
    });

    it("allows destructive command when pattern is cached", () => {
      cache.add("Bash(git push:*)");
      const result = resolvePermission(
        "Bash",
        { command: "git push origin main" },
        WORKTREE,
        cache,
      );
      expect(result).toBe("allow");
    });

    it("prompts for bash commands with absolute paths outside worktree", () => {
      const result = resolvePermission(
        "Bash",
        { command: "cat /etc/hosts" },
        WORKTREE,
        cache,
      );
      expect(result).toMatchObject({ needs_prompt: true });
    });

    it("allows bash commands with /dev/null", () => {
      const result = resolvePermission(
        "Bash",
        { command: "echo hello > /dev/null" },
        WORKTREE,
        cache,
      );
      expect(result).toBe("allow");
    });
  });

  describe("unknown tools", () => {
    it("auto-allows unknown tools", () => {
      const result = resolvePermission("UnknownTool", {}, WORKTREE, cache);
      expect(result).toBe("allow");
    });
  });

  describe("NotebookRead/NotebookEdit", () => {
    it("allows NotebookRead within worktree using notebook_path", () => {
      const result = resolvePermission(
        "NotebookRead",
        { notebook_path: `${WORKTREE}/notebook.ipynb` },
        WORKTREE,
        cache,
      );
      expect(result).toBe("allow");
    });

    it("prompts for NotebookEdit outside worktree", () => {
      const result = resolvePermission(
        "NotebookEdit",
        { notebook_path: "/home/user/other/notebook.ipynb" },
        WORKTREE,
        cache,
      );
      expect(result).toMatchObject({ needs_prompt: true });
    });
  });
});

// ---------------------------------------------------------------------------
// appendToSettingsLocal
// ---------------------------------------------------------------------------

describe("appendToSettingsLocal", () => {
  beforeEach(() => {
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
  });

  it("creates new settings file if it does not exist", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    appendToSettingsLocal(WORKTREE, "Read(/some/path)");

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      path.join(WORKTREE, ".claude"),
      { recursive: true },
    );
    expect(fs.writeFileSync).toHaveBeenCalled();
    const written = JSON.parse(
      (vi.mocked(fs.writeFileSync).mock.calls[0][1] as string).trim()
    );
    expect(written.permissions.allow).toContain("Read(/some/path)");
  });

  it("appends to existing settings.local.json", () => {
    const existing = JSON.stringify({
      permissions: { allow: ["Bash(npm:*)"] },
    });
    vi.mocked(fs.readFileSync).mockReturnValue(existing as any);

    appendToSettingsLocal(WORKTREE, "Read(/some/path)");

    const written = JSON.parse(
      (vi.mocked(fs.writeFileSync).mock.calls[0][1] as string).trim()
    );
    expect(written.permissions.allow).toContain("Bash(npm:*)");
    expect(written.permissions.allow).toContain("Read(/some/path)");
  });

  it("does not add duplicate patterns", () => {
    const existing = JSON.stringify({
      permissions: { allow: ["Read(/some/path)"] },
    });
    vi.mocked(fs.readFileSync).mockReturnValue(existing as any);

    appendToSettingsLocal(WORKTREE, "Read(/some/path)");

    const written = JSON.parse(
      (vi.mocked(fs.writeFileSync).mock.calls[0][1] as string).trim()
    );
    expect(written.permissions.allow.filter((p: string) => p === "Read(/some/path)")).toHaveLength(1);
  });

  it("creates permissions object if missing from existing file", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ someOtherKey: true }) as any
    );

    appendToSettingsLocal(WORKTREE, "Write(/path)");

    const written = JSON.parse(
      (vi.mocked(fs.writeFileSync).mock.calls[0][1] as string).trim()
    );
    expect(written.permissions.allow).toContain("Write(/path)");
  });
});
