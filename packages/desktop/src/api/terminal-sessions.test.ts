import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalSessionInfo } from "@/api/generated";

const listTerminalSessions = vi.fn();

vi.mock("@/api/generated", () => ({
  listTerminalSessions: (...args: unknown[]) => listTerminalSessions(...args),
  getListTerminalSessionsQueryKey: (params: unknown) => ["/api/terminal/sessions", params],
}));

import { fetchTerminalSessions } from "./terminal-sessions";
import { queryClient } from "@/lib/queryClient";

function sessions(): TerminalSessionInfo[] {
  return [{ pty_id: "pty-1", cwd: "/repo", alive: true, foreground_active: false }];
}

function deferred(): {
  promise: Promise<TerminalSessionInfo[]>;
  resolve: (value: TerminalSessionInfo[]) => void;
} {
  let resolve!: (value: TerminalSessionInfo[]) => void;
  const promise = new Promise<TerminalSessionInfo[]>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("fetchTerminalSessions", () => {
  beforeEach(() => {
    listTerminalSessions.mockReset();
    queryClient.clear();
  });

  it("collapses concurrent same-feature reads into one request", async () => {
    const gate = deferred();
    listTerminalSessions.mockReturnValueOnce(gate.promise);

    const first = fetchTerminalSessions(1);
    const second = fetchTerminalSessions(1);

    expect(listTerminalSessions).toHaveBeenCalledTimes(1);

    gate.resolve(sessions());
    await Promise.all([first, second]);
  });

  it("reuses the cached result within the dedupe window", async () => {
    listTerminalSessions.mockResolvedValue(sessions());

    await fetchTerminalSessions(1);
    await fetchTerminalSessions(1);

    expect(listTerminalSessions).toHaveBeenCalledTimes(1);
  });

  it("refetches when a caller demands a fresh snapshot", async () => {
    listTerminalSessions.mockResolvedValue(sessions());

    await fetchTerminalSessions(1);
    await fetchTerminalSessions(1, { fresh: true });

    expect(listTerminalSessions).toHaveBeenCalledTimes(2);
  });
});
