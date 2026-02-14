/**
 * @deprecated This module is superseded by the session-list model in useWorkflowAgents.
 * The session entry list IS the entry list — no separate conversion needed.
 * This file re-exports types for backwards compatibility. Will be deleted in Phase 7.
 */

import type { AgentStatus } from "@/components/AgentPanel";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentType } from "../../main/agents/types";

/**
 * @deprecated Use SessionEntry from useWorkflowAgents instead.
 */
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
