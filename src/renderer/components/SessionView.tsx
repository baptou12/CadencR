import { useEffect, useMemo, useCallback } from "react";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { trpc } from "@/trpc";
import { useAgentState, useAgentEventListener } from "@/hooks/useAgentState";
import type { AgentBlockData } from "@/components/AgentBlock";
import { AgentStream } from "@/components/AgentStream";
import { AgentPromptBar } from "@/components/AgentPromptBar";

export function SessionView({
  featureId,
  projectId,
}: {
  featureId: number;
  projectId: number;
}) {
  const session = useAgentState();

  // Restore: find the latest session's history and reconnect to active subprocess
  const activeProcess = trpc.agents.getActiveSessionProcess.useQuery({ featureId });
  const sessionsQuery = trpc.agents.getSessions.useQuery({ featureId });

  const lastSessionDbId = useMemo(() => {
    if (!sessionsQuery.data) return null;
    const s = sessionsQuery.data.find((r) => r.agent_type === "session");
    return s?.id ?? null;
  }, [sessionsQuery.data]);

  const historyQuery = trpc.agents.getHistory.useQuery(
    { sessionId: lastSessionDbId ?? 0 },
    { enabled: !!lastSessionDbId && session.status === "idle" && session.blocks.length === 0 },
  );

  // On mount: restore blocks from history and reconnect to active subprocess
  useEffect(() => {
    if (!historyQuery.data || historyQuery.data.length === 0) return;
    if (session.status !== "idle" || session.blocks.length > 0) return;

    for (const msg of historyQuery.data) {
      const id = `hist-${Math.random().toString(36).slice(2)}`;
      let block: AgentBlockData | null = null;
      switch (msg.message_type) {
        case "text": block = { id, type: "text", content: msg.content }; break;
        case "tool_call": block = { id, type: "tool_call", content: msg.content, toolName: msg.tool_name ?? "tool", toolArgs: msg.content }; break;
        case "tool_result": case "tool_error": block = { id, type: "tool_result", content: msg.content, isError: msg.message_type === "tool_error" }; break;
        case "user_message": block = { id, type: "user_message", content: msg.content }; break;
        case "error": block = { id, type: "text", content: `Error: ${msg.content}` }; break;
      }
      if (block) session.appendBlock(block);
    }

    // Reconnect to active subprocess or mark as paused/complete
    if (activeProcess.data) {
      session.trackSubprocess(activeProcess.data.subprocessId);
      session.setStatus(activeProcess.data.status === "running" ? "running" : "paused");
    } else {
      session.setStatus("paused");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyQuery.data, activeProcess.data]);

  // Event listener for session agent
  const eventHandlers = useMemo(
    () => ({
      session: {
        handleEvent: session.handleEvent,
        subprocessIdRef: session.subprocessIdRef,
      },
    }),
    [session.handleEvent, session.subprocessIdRef],
  );
  useAgentEventListener(eventHandlers);

  // Mutations
  const startSessionMutation = trpc.agents.startSession.useMutation();
  const sendMessageMutation = trpc.agents.sendMessage.useMutation();
  const interruptMutation = trpc.agents.interrupt.useMutation();

  const handleSend = useCallback(
    async (message: string) => {
      if (session.subprocessId && (session.status === "running" || session.status === "paused")) {
        // Subprocess is alive — send follow-up message
        session.appendBlock({ type: "user_message", content: message });
        sendMessageMutation.mutate({ id: session.subprocessId, message });
        session.setStatus("running");
        return;
      }

      // Start a new session
      session.start();
      session.appendBlock({ type: "user_message", content: message });
      try {
        const result = await startSessionMutation.mutateAsync({
          featureId,
          projectId,
          prompt: message,
        });
        session.trackSubprocess(result.subprocessId);
      } catch (err) {
        session.setStatus("error");
        session.appendBlock({
          type: "text",
          content: `Failed to start session: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.status, session.subprocessId, featureId, projectId, sendMessageMutation, startSessionMutation],
  );

  const handleStop = useCallback(async () => {
    if (!session.subprocessId) return;
    try {
      await interruptMutation.mutateAsync({ id: session.subprocessId });
    } catch {
      // best effort
    }
  }, [session.subprocessId, interruptMutation]);

  const isIdle = session.status === "idle" && session.blocks.length === 0;

  return (
    <div className="flex h-full flex-col">
      <FeatureTopBar featureId={featureId} projectId={projectId} mode="session" />

      {/* Scrollable agent output */}
      <div className="flex-1 overflow-auto p-4">
        {isIdle && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Send a message to start a session with Claude Code.
            </p>
          </div>
        )}
        {session.blocks.length > 0 && (
          <AgentStream
            blocks={session.blocks}
            isStreaming={session.status === "running"}
          />
        )}
      </div>

      {/* Prompt bar pinned at bottom */}
      <AgentPromptBar
        onSend={handleSend}
        onStop={handleStop}
        status={session.status}
        disabled={startSessionMutation.isLoading}
      />
    </div>
  );
}
