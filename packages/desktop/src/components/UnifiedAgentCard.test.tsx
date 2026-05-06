import { render } from "@/test-utils";
import type { UnifiedAgentEntry } from "@/api/generated";
import type { AgentBlockData } from "@/components/AgentBlock";
import { createSessionEntry } from "@/stores/ws-session-types";
import { useWsSessionStore } from "@/stores/ws-session-store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnifiedAgentCard } from "./UnifiedAgentCard";

const mocks = vi.hoisted(() => ({
  WebSocketSessionFeatureBlock: vi.fn(() => <div data-testid="ws-block" />),
  togglePin: vi.fn(),
}));

vi.mock("@/components/WebSocketSessionFeatureBlock", () => ({
  WebSocketSessionFeatureBlock: mocks.WebSocketSessionFeatureBlock,
}));

vi.mock("@/components/useUnifiedAgentPinControls", () => ({
  useUnifiedAgentPinControls: () => ({ isPending: false, toggle: mocks.togglePin }),
}));

vi.mock("@/components/EmbeddedFeatureHeader", () => ({
  EmbeddedFeatureHeader: () => null,
}));

vi.mock("@/components/agent-session", () => ({
  AgentSession: () => null,
}));

function makeEntry(overrides: Partial<UnifiedAgentEntry["session"]> = {}): UnifiedAgentEntry {
  return {
    agent_created_at: "2026-05-04T00:00:00Z",
    feature: {
      created_at: "2026-05-04T00:00:00Z",
      id: 7,
      status: "active",
      title: "Session feature",
      type: "ws-session",
    },
    is_pinned: false,
    last_activity_at: "2026-05-04T00:00:00Z",
    project: { id: 3, name: "Project", path: "/repo" },
    session: {
      agentType: "session",
      blocks: [],
      contextWindow: null,
      draftPrompt: null,
      hasFileChanges: false,
      hasMore: false,
      inputTokens: 0,
      isIncremental: false,
      maxMessageId: 0,
      model: null,
      oldestMessageId: null,
      outputTokens: 0,
      pendingPermission: null,
      pendingPlanApproval: null,
      pendingPrdApproval: null,
      pendingQuestions: null,
      permissionMode: "default",
      phaseId: null,
      phaseTitle: null,
      resumable: false,
      runId: null,
      runtimeProvider: null,
      runtimeSessionId: null,
      sessionDbId: 42,
      status: "idle",
      subprocessId: null,
      todos: null,
      toolCallUpdates: null,
      wasCompacted: false,
      ...overrides,
    },
  };
}

describe("UnifiedAgentCard ws-session hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWsSessionStore.setState({ sessions: {} });
  });

  it("hydrates an empty embedded session from the unified polling snapshot", () => {
    render(
      <UnifiedAgentCard
        entry={makeEntry({ status: "running", model: "model-a", runtimeProvider: "codex_cli" })}
        index={0}
        isActive={false}
        onActivate={vi.fn()}
      />,
    );

    const session = useWsSessionStore.getState().sessions["ws-feature-7"];
    expect(session?.persistedLoaded).toBe(true);
    expect(session?.lifecycle).toEqual({ phase: "active" });
    expect(session?.currentModelId).toBe("model-a");
    expect(session?.currentProviderId).toBe("codex_cli");
  });

  it("patches pending metadata without replacing live blocks", () => {
    const liveBlocks: AgentBlockData[] = [{ id: "live", type: "text", content: "streaming" }];
    useWsSessionStore.setState({
      sessions: {
        "ws-feature-7": {
          ...createSessionEntry(),
          blocks: liveBlocks,
          rootBlocks: liveBlocks,
          lifecycle: { phase: "active" },
          persistedLoaded: true,
        },
      },
    });

    render(
      <UnifiedAgentCard
        entry={makeEntry({
          hasFileChanges: true,
          model: "model-b",
          pendingPermission: {
            toolName: "Bash",
            input: { command: "git status" },
            description: "Run git status",
            pattern: "git status",
            requestId: "perm-1",
          },
          permissionMode: "bypassPermissions",
          runtimeProvider: "opencode",
          status: "running",
        })}
        index={0}
        isActive
        onActivate={vi.fn()}
      />,
    );

    const session = useWsSessionStore.getState().sessions["ws-feature-7"];
    expect(session?.blocks).toBe(liveBlocks);
    expect(session?.pendingPermission?.toolName).toBe("Bash");
    expect(session?.pendingRequestId).toBe("perm-1");
    expect(session?.lifecycle).toEqual({ phase: "paused", reason: "permission" });
    expect(session?.currentModelId).toBe("model-b");
    expect(session?.hasFileChanges).toBe(true);
  });
});
