import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useHotkeys } from "react-hotkeys-hook";
import { trpc } from "@/trpc";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { AgentSession, type AgentSessionHandle } from "@/components/AgentSession";
import { FeatureWorkflowView } from "@/components/FeatureWorkflowView";
import { DiffViewerModal, type ExecuteAgentState } from "@/components/diff/DiffViewerModal";
import { TerminalPanel, type TerminalPanelHandle } from "@/components/terminal/TerminalPanel";
import { useFeatureAgentState } from "@/hooks/useFeatureAgentState";
import { useContextUsage } from "@/hooks/useContextUsage";
import { useResolvedModel } from "@/hooks/useResolvedModel";
import { getActiveFocusZone } from "@/lib/focus-zones";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { useTerminalState } from "@/hooks/useTerminalState";
import { useAgentChat, usePermissionMode } from "@/hooks/useAgentChat";

export const Route = createFileRoute(
  "/projects/$projectId/features/$featureId",
)({
  component: FeaturePage,
});

function FeaturePage() {
  const { featureId, projectId } = Route.useParams();
  const numericFeatureId = Number(featureId);
  const numericProjectId = Number(projectId);

  const featureQuery = trpc.features.getById.useQuery({
    id: numericFeatureId,
  });
  const feature = featureQuery.data ?? undefined;

  if (feature?.type === "session") {
    return (
      <SessionFeatureView
        featureId={numericFeatureId}
        projectId={numericProjectId}
      />
    );
  }

  return (
    <FeatureWorkflowView
      featureId={numericFeatureId}
      projectId={numericProjectId}
      feature={feature}
      featureQuery={featureQuery}
    />
  );
}

// ---------------------------------------------------------------------------
// Session feature — uses AgentSession in full-screen mode
// ---------------------------------------------------------------------------

function SessionFeatureView({
  featureId,
  projectId,
}: {
  featureId: number;
  projectId: number;
}) {
  const { sessions, refetch } = useFeatureAgentState(featureId);
  const contextUsageMap = useContextUsage(featureId, sessions);
  const agentRef = useRef<AgentSessionHandle>(null);
  const [inlineDiffOpen, setInlineDiffOpen] = useState(false);
  const handleViewDiff = useCallback(() => setInlineDiffOpen(true), []);

  // Model settings for the session (resolved through hierarchy)
  const { resolveModel, handleModelChange: handleModelChangeRaw } = useResolvedModel(featureId, projectId);
  const currentModelId = resolveModel("session");
  const handleModelChange = useCallback(
    (modelId: string) => handleModelChangeRaw("session", modelId),
    [handleModelChangeRaw],
  );

  // Auto-focus prompt bar when session view mounts (e.g. after creating a new session)
  useEffect(() => {
    requestAnimationFrame(() => {
      agentRef.current?.focusPromptBar();
    });
  }, []);

  // CMD+OPT+UP/DOWN: focus the active input (prompt, permission, or question)
  useHotkeys(
    "meta+alt+down,meta+alt+up",
    (e) => {
      const zone = getActiveFocusZone();
      if (zone && zone !== "main-content") return;
      e.preventDefault();
      agentRef.current?.focusActiveInput();
    },
    { enableOnFormTags: true },
  );

  // Find the latest session agent
  const session = sessions.findLast((s) => s.agentType === "session");
  const sessionAgentState: ExecuteAgentState | undefined = useMemo(() => {
    if (!session?.subprocessId) return undefined;
    if (session.status !== "running" && session.status !== "completed" && session.status !== "paused") return undefined;
    return {
      subprocessId: session.subprocessId,
      status: session.status,
      pendingQuestions: session.pendingQuestions ?? null,
    };
  }, [session?.subprocessId, session?.status, session?.pendingQuestions]);
  const status = session?.status ?? "idle";
  const blocks = session?.blocks ?? [];
  const hasFileChanges = session?.hasFileChanges ?? false;
  const todos = session?.todos ?? null;

  // Shared agent chat handlers (permission, plan approval, answers)
  const chat = useAgentChat({ featureId, projectId, refetch });
  const { permissionMode, handlePermissionModeToggle, setPermissionMode } = usePermissionMode(session);

  // Session-specific mutations
  const startSessionMutation = trpc.agents.startSession.useMutation();
  const sendMessageMutation = trpc.agents.sendMessage.useMutation();
  const interruptMutation = trpc.agents.interrupt.useMutation();
  const resumeMutation = trpc.agents.resume.useMutation();

  const handleSend = useCallback(
    async (message: string) => {
      console.log("[SessionFeatureView] handleSend", { hasSession: !!session, subprocessId: session?.subprocessId, status, permissionMode, claudeSessionId: session?.claudeSessionId });
      // 1. Active subprocess — send follow-up message directly.
      //    For session agents, the subprocess stays alive in activeProcesses even
      //    after a turn completes (status becomes "completed"). The backend's
      //    sendMessageToSubprocess handles "completed" status by re-running the
      //    SDK query with resume, so we can route follow-up messages through it
      //    instead of spawning a brand-new subprocess via the resume mutation.
      if (session?.subprocessId && (status === "running" || status === "completed")) {
        try {
          const result = await sendMessageMutation.mutateAsync({ id: session.subprocessId, message });
          if (result.success) {
            // Always refetch so the user message appears immediately in the chat
            void refetch();
            return;
          }
          // Send failed (e.g., process dead after restart) — fall through to resume/start paths
        } catch {
          // Mutation error — fall through to resume/start paths
        }
      }

      // 2. Existing session with a claude session ID — resume it
      if (session?.claudeSessionId) {
        try {
          await resumeMutation.mutateAsync({
            featureId,
            projectId,
            agentType: "session",
            sessionId: session.claudeSessionId,
            originalSessionDbId: session.sessionDbId,
            prompt: message,
          });
        } catch (err) {
          console.error("[SessionFeatureView] Failed to resume session:", err);
        }
        void refetch();
        return;
      }

      // 3. No session yet — start a new one
      try {
        await startSessionMutation.mutateAsync({
          featureId,
          projectId,
          prompt: message,
          permissionMode,
        });
      } catch (err) {
        console.error("[SessionFeatureView] Failed to start session:", err);
      }
      void refetch();
    },
    [session, status, featureId, projectId, permissionMode, sendMessageMutation, startSessionMutation, resumeMutation, refetch],
  );

  const handleStop = useCallback(async () => {
    if (!session?.subprocessId) return;
    try {
      await interruptMutation.mutateAsync({ id: session.subprocessId });
    } catch {
      // best effort
    }
    void refetch();
  }, [session?.subprocessId, interruptMutation, refetch]);

  // Terminal panel state
  const terminalRef = useRef<TerminalPanelHandle>(null);
  const terminalState = useTerminalState(featureId);
  const terminalHeightSetting = useDebouncedSetting("terminal_panel_height_px");
  const [terminalHeightPx, setTerminalHeightPx] = useState(300);

  // Sync height from DB when setting loads
  useEffect(() => {
    const saved = Number(terminalHeightSetting.value);
    if (saved > 0) setTerminalHeightPx(saved);
  }, [terminalHeightSetting.value]);

  const handleTerminalToolbarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = terminalHeightPx;
    const onMouseMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      const newHeight = Math.round(Math.max(80, Math.min(window.innerHeight * 0.8, startHeight + delta)));
      setTerminalHeightPx(newHeight);
      terminalHeightSetting.setValue(String(newHeight));
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [terminalHeightPx, terminalHeightSetting]);

  /** Focus the session prompt bar (used when terminal collapses) */
  const focusSessionPrompt = useCallback(() => {
    requestAnimationFrame(() => {
      agentRef.current?.focusActiveInput();
    });
  }, []);

  // Ctrl+` — toggle terminal panel
  useHotkeys(
    "ctrl+backquote",
    (e) => {
      e.preventDefault();
      const wasOpen = terminalState.isOpen && !terminalState.isMinimized;
      terminalState.togglePanel();
      if (wasOpen) {
        focusSessionPrompt();
      } else {
        requestAnimationFrame(() => terminalRef.current?.focusActivePane());
      }
    },
    { enableOnFormTags: true },
  );

  // Ctrl+Shift+` — add a new split pane (only when panel is open)
  useHotkeys(
    "ctrl+shift+backquote",
    (e) => {
      if (!terminalState.isOpen || terminalState.isMinimized) return;
      e.preventDefault();
      terminalState.addPane();
    },
    { enableOnFormTags: true },
  );

  return (
    <div className="flex h-full flex-col">
      <FeatureTopBar featureId={featureId} projectId={projectId} mode="session" executeState={sessionAgentState} className="shrink-0" />
      {(status === "paused" || status === "completed") && !session?.subprocessId && session?.claudeSessionId && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
          Previous session paused — type a message to resume.
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AgentSession
          ref={agentRef}
          agentType="session"
          blocks={blocks}
          status={status}
          onSend={handleSend}
          onStop={handleStop}
          pendingQuestions={session?.pendingQuestions ?? undefined}
          onAnswerSubmit={(response) => chat.handleAnswerSubmit(session, response)}
          disabled={startSessionMutation.isLoading || resumeMutation.isLoading}
          hasFileChanges={hasFileChanges}
          onViewDiff={handleViewDiff}
          todos={todos}
          permissionMode={permissionMode}
          onPermissionModeToggle={handlePermissionModeToggle}
          pendingPlanApproval={session?.pendingPlanApproval}
          onPlanApprove={() => {
            chat.handlePlanApprove(session?.subprocessId);
            setPermissionMode("acceptEdits");
          }}
          onPlanRequestChanges={(feedback) => chat.handlePlanRequestChanges(session?.subprocessId, feedback)}
          contextUsage={session ? contextUsageMap.get(session.sessionDbId) : null}
          currentModelId={currentModelId}
          onModelChange={handleModelChange}
          featureId={featureId}
          projectId={projectId}
          subprocessId={session?.subprocessId ?? undefined}
          pendingPermission={session?.pendingPermission}
          onPermissionDecision={(decision, feedback) => chat.handlePermissionDecision(session?.subprocessId, decision, feedback)}
          className="h-full"
        />
        {terminalState.panes.length > 0 && (
          <div
            className="absolute bottom-0 left-0 right-0 border-t border-[#292e42] transition-transform duration-150 ease-in-out"
            style={{
              height: terminalState.isMinimized ? 32 : terminalHeightPx,
              transform: terminalState.isOpen ? "translateY(0)" : "translateY(100%)",
            }}
          >
            <TerminalPanel
              ref={terminalRef}
              featureId={featureId}
              projectId={projectId}
              state={terminalState}
              togglePanel={terminalState.togglePanel}
              addPane={terminalState.addPane}
              removePane={terminalState.removePane}
              minimize={terminalState.minimize}
              onToolbarMouseDown={handleTerminalToolbarMouseDown}
              onCollapse={focusSessionPrompt}
            />
          </div>
        )}
      </div>
      <DiffViewerModal
        featureId={featureId}
        open={inlineDiffOpen}
        onOpenChange={setInlineDiffOpen}
        executeState={sessionAgentState}
      />
    </div>
  );
}
