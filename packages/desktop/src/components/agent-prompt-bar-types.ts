import type { ReactNode } from "react";
import type { SlashCommand } from "@/hooks/useSlashCommand";
import type { LiveAgentStatus } from "@/types/agent";
import type { PermissionMode } from "@/types/permission-mode";
import type { AgentQuestion, AgentQuestionAnswers } from "./AgentQuestionDrawer";
import type { PendingPermission, PermissionDecisionValue } from "./ToolPermissionPrompt";

export interface SplitSendAction {
  label: string;
  icon: ReactNode;
  onClick: (
    text: string,
    images?: Array<{ base64: string; mimeType: string }>,
  ) => void | Promise<void>;
  variant?: "default" | "outline";
  kbdShortcut?: string[];
}

export interface AgentPromptBarProps {
  /**
   * Called when the user submits the prompt. May return a Promise — the
   * prompt bar awaits it before clearing the input so a failed save
   * (e.g. worktree settings persistence) doesn't drop the user's text.
   * Errors are surfaced via toast inside the consumer; the bar restores
   * the draft on rejection.
   */
  onSend: (
    message: string,
    images?: Array<{ base64: string; mimeType: string }>,
  ) => void | Promise<void>;
  onStop: () => void;
  status: LiveAgentStatus;
  splitSendActions?: SplitSendAction[];
  disabled?: boolean;
  pendingQuestions?: AgentQuestion[];
  onQuestionResponse?: (response: AgentQuestionAnswers) => void;
  disableShortcuts?: boolean;
  onCollapse?: () => void;
  permissionMode?: PermissionMode;
  onPermissionModeToggle?: () => void;
  pendingPlanApproval?: { allowedPrompts?: Array<{ tool: string; prompt: string }> } | null;
  planFeedbackDefault?: string;
  planApproveLabel?: string;
  planApprovalError?: string | null;
  onPlanApprove?: () => void;
  onPlanRequestChanges?: (feedback: string) => void;
  onPlanReject?: () => void;
  onOpenModelPicker?: () => void;
  agentTabActive?: boolean;
  featureId?: number;
  projectId?: number;
  sessionId?: number;
  wsSessionId?: string;
  initialDraft?: string | null;
  onToggleMaximize?: () => void;
  noTopPadding?: boolean;
  slashCommandsOverride?: SlashCommand[];
  slashCommandsLoading?: boolean;
  pendingPermission?: PendingPermission | null;
  onPermissionDecision?: (
    decision: PermissionDecisionValue,
    feedback?: string,
    optionId?: string,
  ) => void;
}

export interface AgentPromptBarHandle {
  focusInput: () => void;
}
