import { render } from "@/test-utils";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketSessionFeatureBlock } from "./WebSocketSessionFeatureBlock";

const mocks = vi.hoisted(() => ({
  setPaneActiveTab: vi.fn(),
  useSessionFeatureData: vi.fn(),
  useSessionControls: vi.fn(),
  useSessionRefs: vi.fn(),
  useWsSessionEffects: vi.fn(),
  useWsSessionShortcuts: vi.fn(),
}));

vi.mock("@/components/FeatureTopBar", () => ({
  FeatureTopBar: () => null,
}));

vi.mock("@/components/diff/DiffViewerModal", () => ({
  DiffViewerModal: () => null,
}));

vi.mock("@/components/feature-layout/FeatureLayoutContext", () => ({
  FeatureLayoutProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/components/feature-layout/FeatureLayoutShell", () => ({
  FeatureLayoutShell: () => null,
}));

vi.mock("@/hooks/useSaveLastOpenedFeature", () => ({
  useSaveLastOpenedFeature: vi.fn(),
}));

vi.mock("@/stores/feature-layout-store", () => ({
  findPaneContaining: () => null,
  getFocusedTab: () => "agent",
  isTabVisible: () => false,
  selectFeatureLayout: () => () => ({}),
  useFeatureLayoutStore: (
    selector: (state: {
      features: Record<number, unknown>;
      setPaneActiveTab: typeof mocks.setPaneActiveTab;
    }) => unknown,
  ) => selector({ features: {}, setPaneActiveTab: mocks.setPaneActiveTab }),
}));

vi.mock("@/components/WebSocketSessionFeatureBlockHooks", () => ({
  useSessionFeatureData: mocks.useSessionFeatureData,
  useSessionControls: mocks.useSessionControls,
  useSessionRefs: mocks.useSessionRefs,
  useWsSessionEffects: mocks.useWsSessionEffects,
  useWsSessionShortcuts: mocks.useWsSessionShortcuts,
}));

vi.mock("@/components/WebSocketSessionFeatureBlockTabs", () => ({
  useSessionTabs: () => ({}),
}));

describe("WebSocketSessionFeatureBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSessionFeatureData.mockReturnValue({
      projectPath: "/repo",
      gitStats: undefined,
      gitBranch: undefined,
      featureSettings: {},
      session: { serverSessionId: "" },
      effectiveCwd: "/repo",
      worktreeStatus: "idle",
      worktreeBranch: null,
      requestSlashCommands: vi.fn(),
      handleRetryWorktreeSetup: vi.fn(),
    });
    mocks.useSessionControls.mockReturnValue({
      ws: { sendPrompt: vi.fn() },
      featureSettings: {},
    });
    mocks.useSessionRefs.mockReturnValue({
      agent: { current: null },
      terminal: { current: null },
      editor: { current: null },
    });
  });

  it("keeps embedded sessions from auto-initializing even when active", () => {
    render(
      <WebSocketSessionFeatureBlock
        sessionId="ws-feature-1"
        cwd="/repo"
        featureId={1}
        projectId={2}
        embedded
        hotkeysEnabled
      />,
    );

    expect(mocks.useWsSessionEffects).toHaveBeenCalledWith(
      expect.objectContaining({ autoInitSession: false, hotkeysEnabled: true }),
    );
  });

  it("allows route sessions to auto-initialize", () => {
    render(
      <WebSocketSessionFeatureBlock
        sessionId="ws-feature-1"
        cwd="/repo"
        featureId={1}
        projectId={2}
        hotkeysEnabled={false}
      />,
    );

    expect(mocks.useWsSessionEffects).toHaveBeenCalledWith(
      expect.objectContaining({ autoInitSession: true, hotkeysEnabled: false }),
    );
  });
});
