import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";
import React from "react";

const { mockGetSettings, mockSetSetting } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(() => ({
    data: {
      branch_prefix: "feature/",
      agent_autonomy: "1",
      setup_worktree: "pnpm install",
      qa_prompt: "pnpm test",
    },
  })),
  mockSetSetting: vi.fn(),
}));

vi.mock("@/trpc", () => ({
  trpc: {
    createClient: vi.fn(() => ({})),
    Provider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useUtils: vi.fn(() => ({
      projects: { getSettings: { invalidate: vi.fn() }, getModelSettings: { invalidate: vi.fn() } },
      settings: { getModelSettings: { invalidate: vi.fn() } },
      features: { getModelSettings: { invalidate: vi.fn() } },
    })),
    projects: {
      getSettings: { useQuery: mockGetSettings },
      setSetting: { useMutation: vi.fn(() => ({ mutate: mockSetSetting })) },
      getModelSettings: { useQuery: vi.fn(() => ({ data: {}, isLoading: false })) },
      setModelSetting: { useMutation: vi.fn(() => ({ mutate: vi.fn() })) },
    },
    settings: {
      getAvailableModels: { useQuery: vi.fn(() => ({ data: [{ id: "claude-opus-4-6", label: "Claude Opus 4.6" }] })) },
      getModelSettings: { useQuery: vi.fn(() => ({ data: {}, isLoading: false })) },
      setModelSetting: { useMutation: vi.fn(() => ({ mutate: vi.fn() })) },
    },
    features: {
      getModelSettings: { useQuery: vi.fn(() => ({ data: {}, isLoading: false })) },
      setModelSetting: { useMutation: vi.fn(() => ({ mutate: vi.fn() })) },
    },
  },
}));

describe("ProjectSettingsDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ProjectSettingsDialog
        projectId={1}
        projectName="My Project"
        open={false}
        onOpenChange={vi.fn()}
      />
    );
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });

  it("renders dialog title with project name when open", () => {
    render(
      <ProjectSettingsDialog
        projectId={1}
        projectName="My Project"
        open={true}
        onOpenChange={vi.fn()}
      />
    );
    expect(screen.getByText("Project Settings: My Project")).toBeInTheDocument();
  });

  it("renders branch prefix input", () => {
    render(
      <ProjectSettingsDialog
        projectId={1}
        projectName="Test"
        open={true}
        onOpenChange={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText(/e.g. feature\//i)).toBeInTheDocument();
  });

  it("renders setup worktree label", () => {
    render(
      <ProjectSettingsDialog
        projectId={1}
        projectName="Test"
        open={true}
        onOpenChange={vi.fn()}
      />
    );
    expect(screen.getByText("Worktree Setup Commands")).toBeInTheDocument();
  });

  it("renders agent autonomy selector", () => {
    render(
      <ProjectSettingsDialog
        projectId={1}
        projectName="Test"
        open={true}
        onOpenChange={vi.fn()}
      />
    );
    expect(screen.getByText("Agent Autonomy")).toBeInTheDocument();
  });

  it("closes dialog when escape is pressed", async () => {
    const onOpenChange = vi.fn();
    const { user } = render(
      <ProjectSettingsDialog
        projectId={1}
        projectName="Test"
        open={true}
        onOpenChange={onOpenChange}
      />
    );
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
