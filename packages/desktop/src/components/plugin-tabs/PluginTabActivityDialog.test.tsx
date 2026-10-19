import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PluginTabActivity } from "@/api/generated";
import { setPluginTabActivityOpen } from "@/lib/plugin-tabs/runtime-store";
import { render, screen, within } from "@/test-utils";

import { PluginTabActivityDialog } from "./PluginTabActivityDialog";
import { pluginTabSummary } from "./plugin-tab-fixtures";

const mocks = vi.hoisted(() => ({
  activity: null as PluginTabActivity | null,
  stop: vi.fn(),
}));

vi.mock("@/api/generated", async (importOriginal) => {
  const { useMutation, useQuery } = await import("@tanstack/react-query");
  return {
    ...(await importOriginal<typeof import("@/api/generated")>()),
    usePluginTabActivity: () =>
      useQuery({ queryKey: ["/api/plugin-tabs/x/activity"], queryFn: () => mocks.activity }),
    usePluginTabStopBackend: () => useMutation({ mutationFn: mocks.stop }),
  };
});

const INSTANCE = "7:plugin:monitor";

const SUMMARY = pluginTabSummary({
  id: "monitor",
  name: "Port monitor",
  access_level: "backend",
  commands: [{ program: "git", reasoning: "History." }],
  backend: { command: "node", args: ["backend/server.mjs"], reasoning: "Ports." },
});

afterEach(() => act(() => setPluginTabActivityOpen(null)));

function renderOpen() {
  render(<PluginTabActivityDialog instanceId={INSTANCE} featureId={7} summary={SUMMARY} />);
  act(() => setPluginTabActivityOpen(INSTANCE));
}

describe("PluginTabActivityDialog", () => {
  it("stays closed until its instance is opened", () => {
    render(<PluginTabActivityDialog instanceId={INSTANCE} featureId={7} summary={SUMMARY} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => setPluginTabActivityOpen("7:plugin:other"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists the commands run, refusals included, and the running backend with its log", async () => {
    mocks.activity = {
      commands: [
        {
          program: "bash",
          args: ["-c", "x"],
          started_at: new Date().toISOString(),
          duration_ms: 0,
          outcome: "refused",
          error: "`bash` is not in this tab's commands",
        },
        {
          program: "git",
          args: ["log", "-1"],
          started_at: new Date().toISOString(),
          duration_ms: 12,
          outcome: "exited",
          exit_code: 0,
        },
      ],
      backend: {
        state: "running",
        pid: 4242,
        started_at: new Date().toISOString(),
        starts: 1,
        stderr_tail: ["backend ready"],
      },
    };
    renderOpen();
    const dialog = await screen.findByRole("dialog", { name: "Port monitor activity" });
    expect(within(dialog).getByText("Native code")).toBeInTheDocument();
    const commands = await within(dialog).findByRole("list", { name: "Commands run" });
    expect(within(commands).getByText("bash -c x")).toBeInTheDocument();
    expect(within(commands).getByText("Refused")).toBeInTheDocument();
    expect(within(commands).getByText("git log -1")).toBeInTheDocument();
    expect(within(commands).getByText("Exit 0")).toBeInTheDocument();
    expect(within(dialog).getByText("node backend/server.mjs")).toBeInTheDocument();
    expect(within(dialog).getByText(/Running as process 4242/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Backend log")).toHaveTextContent("backend ready");
    await userEvent.click(within(dialog).getByRole("button", { name: "Stop" }));
    expect(mocks.stop).toHaveBeenCalledWith({ id: "monitor", featureId: 7 }, expect.anything());
  });

  it("says a backend that never started will start on the first request", async () => {
    mocks.activity = { commands: [], backend: null };
    renderOpen();
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/Not started yet/)).toBeInTheDocument();
    expect(within(dialog).getByText(/No command has run/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Stop" })).toBeNull();
  });
});
