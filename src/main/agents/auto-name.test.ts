import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/database");
vi.mock("./cli-discovery", () => ({
  discoverClaudeCli: vi.fn(),
}));
vi.mock("./session-persistence", () => ({
  notifyDbUpdated: vi.fn(),
}));
vi.mock("../git/worktree", () => ({
  setupWorktreeForFeature: vi.fn().mockResolvedValue(undefined),
}));

// Mock the SDK import used in auto-name.ts
const mockQuery = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

import { runAutoNameBlocking } from "./auto-name";
import { discoverClaudeCli } from "./cli-discovery";
import { getDatabase } from "../db/database";
import { notifyDbUpdated } from "./session-persistence";
import { createMockDb } from "../test-utils";

const mockDiscoverCli = vi.mocked(discoverClaudeCli);
const mockGetDatabase = vi.mocked(getDatabase);
const mockNotify = vi.mocked(notifyDbUpdated);

function makeAsyncIterable(messages: unknown[]): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next() {
          if (i < messages.length) return Promise.resolve({ value: messages[i++], done: false });
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}

describe("runAutoNameBlocking", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    mockGetDatabase.mockReturnValue(db as any);
    vi.clearAllMocks();
  });

  it("returns null if CLI not found", async () => {
    mockDiscoverCli.mockResolvedValue(null);

    const result = await runAutoNameBlocking(1, "build dark mode", "/cwd");

    expect(result).toBeNull();
  });

  it("extracts name from __FEATURE_NAME_START__...__FEATURE_NAME_END__ markers", async () => {
    mockDiscoverCli.mockResolvedValue({ path: "/usr/bin/claude", source: "settings" });
    const runFn = vi.fn();
    db.prepare.mockReturnValue({ run: runFn });

    mockQuery.mockReturnValue(makeAsyncIterable([
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "__FEATURE_NAME_START__Add Dark Mode__FEATURE_NAME_END__" },
        },
      },
    ]));

    const result = await runAutoNameBlocking(1, "add dark mode", "/cwd");

    expect(result).toBe("Add Dark Mode");
    expect(runFn).toHaveBeenCalledWith("Add Dark Mode", 1);
    expect(mockNotify).toHaveBeenCalledWith("feature", 1);
  });

  it("uses content_block_start text as accumulated text", async () => {
    mockDiscoverCli.mockResolvedValue({ path: "/usr/bin/claude", source: "shell-path" });
    const runFn = vi.fn();
    db.prepare.mockReturnValue({ run: runFn });

    mockQuery.mockReturnValue(makeAsyncIterable([
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          content_block: { type: "text", text: "__FEATURE_NAME_START__Fix Login Bug__FEATURE_NAME_END__" },
        },
      },
    ]));

    const result = await runAutoNameBlocking(1, "fix login", "/cwd");

    expect(result).toBe("Fix Login Bug");
  });

  it("handles assistant message type", async () => {
    mockDiscoverCli.mockResolvedValue({ path: "/usr/bin/claude", source: "process-path" });
    const runFn = vi.fn();
    db.prepare.mockReturnValue({ run: runFn });

    mockQuery.mockReturnValue(makeAsyncIterable([
      {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "__FEATURE_NAME_START__Refactor Auth__FEATURE_NAME_END__" }],
        },
      },
    ]));

    const result = await runAutoNameBlocking(1, "refactor auth", "/cwd");

    expect(result).toBe("Refactor Auth");
  });

  it("strips quotes from extracted name", async () => {
    mockDiscoverCli.mockResolvedValue({ path: "/usr/bin/claude", source: "common-location" });
    const runFn = vi.fn();
    db.prepare.mockReturnValue({ run: runFn });

    mockQuery.mockReturnValue(makeAsyncIterable([
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: '__FEATURE_NAME_START__"Add Tests"__FEATURE_NAME_END__' },
        },
      },
    ]));

    const result = await runAutoNameBlocking(1, "add tests", "/cwd");

    expect(result).toBe("Add Tests");
  });

  it("returns null if name is empty after extraction", async () => {
    mockDiscoverCli.mockResolvedValue({ path: "/usr/bin/claude", source: "settings" });
    mockQuery.mockReturnValue(makeAsyncIterable([]));

    const result = await runAutoNameBlocking(1, "hello", "/cwd");

    expect(result).toBeNull();
  });

  it("passes correct options to query", async () => {
    mockDiscoverCli.mockResolvedValue({ path: "/opt/homebrew/bin/claude", source: "common-location" });
    db.prepare.mockReturnValue({ run: vi.fn() });

    mockQuery.mockReturnValue(makeAsyncIterable([
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "__FEATURE_NAME_START__Test Feature__FEATURE_NAME_END__" },
        },
      },
    ]));

    await runAutoNameBlocking(1, "test feature", "/my/cwd");

    expect(mockQuery).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        cwd: "/my/cwd",
        pathToClaudeCodeExecutable: "/opt/homebrew/bin/claude",
        allowedTools: [],
      }),
    }));
  });
});
