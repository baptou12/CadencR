import type { Loader2Icon } from "lucide-react";
import type { AgentBlockData } from "../AgentBlock";
import type { AgentType } from "../../types/agent-types";
import type { AgentQuestion, AgentQuestionAnswers } from "../AgentQuestionDrawer";
import type { TodoItem } from "@/types/agent";
import type { ContextUsageState } from "@/types/agent";
import type { PendingPermission } from "../ToolPermissionPrompt";
import type { AgentStatus } from "@/types/agent";
import type { SlashCommand } from "@/hooks/useSlashCommand";
import type { ThinkingEffortLevel } from "@/shared/thinking-effort";

export interface AgentSessionProps {
  /** The type of agent being displayed */
  agentType: AgentType;
  /** The blocks (stream output) to render */
  blocks: AgentBlockData[];
  /** Current status of the agent */
  status: AgentStatus;
  /** Called when the user sends a message via the prompt bar */
  onSend: (message: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  /** Called when the user clicks the stop button */
  onStop: () => void;
  /** Active questions from AskUserQuestion tool calls */
  pendingQuestions?: AgentQuestion[];
  /** Called when the user submits a response to questions */
  onAnswerSubmit?: (response: AgentQuestionAnswers) => void;
  /** When true, disables keyboard shortcuts in the question drawer */
  disableShortcuts?: boolean;
  /** Override label (e.g. "Execute 1" for parallel phases) */
  label?: string;
  /** Override icon (lucide component) */
  icon?: typeof Loader2Icon;
  /** When true, wrap content in a collapsible panel. When false, render full-screen. */
  collapsible?: boolean;
  /** Additional class names */
  className?: string;
  /** Whether to show a "resumable" indicator */
  resumable?: boolean;
  /** Called when user clicks resume */
  onResume?: () => void;
  /** Whether the prompt bar send button should be disabled */
  disabled?: boolean;
  /** Controlled open state (collapsible mode only) */
  open?: boolean;
  /** Toggle callback (collapsible mode only) */
  onToggle?: () => void;
  /** Index for DOM-based keyboard navigation (sets data-nav-agent-index) */
  navAgentIndex?: number;
  /** Whether the agent made file changes during its session */
  hasFileChanges?: boolean;
  /** Called when user clicks "Review Changes" to open the diff viewer */
  onViewDiff?: () => void;
  /** Whether this agent can be deleted */
  canDelete?: boolean;
  /** Called when user clicks delete */
  onDelete?: () => void;
  /** Todo list from TodoWrite tool calls */
  todos?: TodoItem[] | null;
  /** Current permission mode (session agents only) */
  permissionMode?: "acceptEdits" | "plan";
  /** Called when user toggles permission mode */
  onPermissionModeToggle?: () => void;
  /** Pending plan approval from ExitPlanMode tool call */
  pendingPlanApproval?: { allowedPrompts?: Array<{ tool: string; prompt: string }> } | null;
  /** Label for the approve button */
  planApproveLabel?: string;
  /** Error from a failed plan approval attempt */
  planApprovalError?: string | null;
  /** Called when user approves the plan */
  onPlanApprove?: () => void;
  /** Called when user requests changes to the plan */
  onPlanRequestChanges?: (feedback: string) => void;
  /** Called when user rejects the plan and stops the agent */
  onPlanReject?: () => void;
  /** Context usage data for this session */
  contextUsage?: ContextUsageState | null;
  /** Current model ID for the session (used for inline model switcher) */
  currentModelId?: string;
  /** Current runtime provider ID for the session */
  currentProviderId?: string;
  /** Called when the user changes the provider before the first message */
  onProviderChange?: (providerId: string) => void;
  /**
   * Called when the user changes the model via the inline switcher. Receives
   * both the picked provider and model id so handlers don't have to read
   * (potentially stale) provider state from the WS store.
   */
  onModelChange?: (providerId: string, modelId: string) => void;
  /** Current thinking effort override for this live session (unvalidated from the store). */
  currentThinkingEffort?: string;
  /** Called when the user changes live thinking effort */
  onThinkingEffortChange?: (thinkingEffort?: ThinkingEffortLevel) => void;
  /** Feature ID for file mention and slash command support in the prompt bar */
  featureId?: number;
  /** Project ID for slash command support and prompt history in the prompt bar */
  projectId?: number;
  /** Agent session DB ID for draft persistence */
  sessionId?: number;
  /** WS store key for WS-based history and draft persistence */
  wsSessionId?: string;
  /** Initial draft text (restored from DB) */
  initialDraft?: string | null;
  /** Active subprocess ID for slash command support in the prompt bar */
  subprocessId?: string;
  /** Pending tool permission request from canUseTool callback */
  pendingPermission?: PendingPermission | null;
  /** Called when user makes a permission decision */
  onPermissionDecision?: (
    decision: "allow_once" | "allow_future" | "deny",
    feedback?: string,
  ) => void;
  /** Called when user clicks "Mark Done" (session agents in workflow) */
  onMarkDone?: () => void;
  /** Whether this agent is maximized (takes full height, hides others) */
  maximized?: boolean;
  /** Called when user clicks maximize/minimize */
  onToggleMaximize?: () => void;
  /** Runtime provider ID backing this session */
  runtimeProvider?: string;
  /** Opaque runtime session ID to display above the prompt bar */
  runtimeSessionId?: string;
  /** Override slash commands (bypasses tRPC fetch). Used by ws-session. */
  slashCommandsOverride?: SlashCommand[];
  /** Whether the override commands are still loading */
  slashCommandsLoading?: boolean;
  /** Whether older messages exist beyond current window */
  hasMore?: boolean;
  /** Called when user scrolls to top and older messages should be loaded */
  onLoadOlder?: () => Promise<void>;
  /** Whether "use worktree" is toggled on (shown as chip before first message) */
  useWorktree?: boolean;
  /** Called when user toggles the "use worktree" chip */
  onToggleWorktree?: () => void;
  /**
   * Whether the agent tab is the visible tab for this feature. Forwarded
   * to `AgentPromptBar` so its agent-menu shortcuts (⌘P open model picker,
   * ⌘↵, ⇧Tab, ⌘⇧Z) only fire when the agent tab is active. Default: true.
   */
  agentTabActive?: boolean;
}

/** Handle exposed by AgentSession via forwardRef */
export interface AgentSessionHandle {
  /** Focus the prompt bar textarea */
  focusPromptBar: () => void;
  /**
   * Focus the most relevant interactive element in priority order:
   * 1. Permission prompt first button (if pending)
   * 2. Prompt bar / question drawer
   * 3. Header (fallback)
   */
  focusActiveInput: () => void;
  /** Whether the collapsible panel is currently open */
  isOpen: boolean;
}
