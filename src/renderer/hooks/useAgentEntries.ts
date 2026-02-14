import { useState, useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import type { AgentStatus } from "@/components/AgentPanel";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentType } from "../../main/agents/types";

interface AgentState {
  status: AgentStatus;
  blocks: AgentBlockData[];
  subprocessId?: string | null;
  pendingQuestions?: Array<{ question: string; options?: Array<{ label: string; description?: string }> }>;
}

interface MultiExecuteState extends AgentState {
  subprocessList: Array<{
    subprocessId: string;
    blocks: AgentBlockData[];
    status: AgentStatus;
  }>;
}

export interface AgentEntry {
  type: AgentType;
  label: string;
  state: {
    status: AgentStatus;
    blocks: AgentBlockData[];
    subprocessId?: string | null;
    pendingQuestions?: Array<{ question: string; options?: Array<{ label: string; description?: string }> }>;
  };
}

interface UseAgentEntriesParams {
  plan: AgentState;
  brainstorm: AgentState;
  execute: MultiExecuteState;
  risk: AgentState;
  review: AgentState;
}

interface UseAgentEntriesResult {
  agentEntries: AgentEntry[];
  hasAnyAgentOutput: boolean;
  noAgentsRunning: boolean;
  openAgent: string | null;
  setOpenAgent: Dispatch<SetStateAction<string | null>>;
}

export function useAgentEntries({
  plan,
  brainstorm,
  execute,
  risk,
  review,
}: UseAgentEntriesParams): UseAgentEntriesResult {
  const allAgents = useMemo(
    () => [
      { state: plan, label: "Plan" },
      { state: brainstorm, label: "Brainstorm" },
      { state: execute, label: "Execute" },
      { state: risk, label: "Risk" },
      { state: review, label: "Review" },
    ],
    [plan, brainstorm, execute, risk, review],
  );

  // Track which agent panel is open (auto-opens running agents)
  const [openAgent, setOpenAgent] = useState<string | null>(null);

  // Auto-open the currently running agent
  useEffect(() => {
    const running = allAgents.find((a) => a.state.status === "running");
    if (running) {
      setOpenAgent(running.label);
    }
  }, [allAgents]);

  // Build the list of agents that have output (to show in the vertical list)
  const agentEntries = useMemo(() => {
    const hasOutput = (state: { status: string; blocks: AgentBlockData[] }) =>
      state.status !== "idle" || state.blocks.length > 0;

    const entries: AgentEntry[] = [];

    // Planning agents
    if (hasOutput(plan))
      entries.push({ type: "plan", label: "Plan", state: { status: plan.status, blocks: plan.blocks, subprocessId: plan.subprocessId, pendingQuestions: plan.pendingQuestions } });
    if (hasOutput(brainstorm))
      entries.push({
        type: "brainstorm",
        label: "Brainstorm",
        state: { status: brainstorm.status, blocks: brainstorm.blocks, subprocessId: brainstorm.subprocessId, pendingQuestions: brainstorm.pendingQuestions },
      });

    // Build phase agents — expand parallel execute subprocesses into separate entries
    const execSubs = execute.subprocessList.filter(
      (s) => s.subprocessId !== "__global__",
    );
    if (execSubs.length > 1) {
      // Multiple parallel phases — one panel per subprocess
      for (let i = 0; i < execSubs.length; i++) {
        const sub = execSubs[i];
        entries.push({
          type: "execute",
          label: `Execute ${i + 1}`,
          state: {
            status: sub.status,
            blocks: sub.blocks,
            subprocessId: sub.subprocessId,
          },
        });
      }
    } else if (hasOutput(execute)) {
      // Single phase or merged view
      entries.push({ type: "execute", label: "Execute", state: { status: execute.status, blocks: execute.blocks, subprocessId: execute.subprocessId } });
    }

    // Append global blocks (e.g. error messages) if any
    const globalSub = execute.subprocessList.find(
      (s) => s.subprocessId === "__global__",
    );
    if (globalSub && globalSub.blocks.length > 0 && execSubs.length > 1) {
      entries.push({
        type: "execute",
        label: "Execute",
        state: {
          status: execute.status,
          blocks: globalSub.blocks,
        },
      });
    }

    if (hasOutput(risk))
      entries.push({ type: "risk", label: "Risk", state: { status: risk.status, blocks: risk.blocks, subprocessId: risk.subprocessId } });
    if (hasOutput(review))
      entries.push({ type: "review", label: "Review", state: { status: review.status, blocks: review.blocks, subprocessId: review.subprocessId } });

    return entries;
  }, [plan, brainstorm, execute, risk, review]);

  const hasAnyAgentOutput = agentEntries.length > 0;
  const noAgentsRunning = allAgents.filter((a) => a.state.status === "running").length === 0;

  return {
    agentEntries,
    hasAnyAgentOutput,
    noAgentsRunning,
    openAgent,
    setOpenAgent,
  };
}
