import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
} from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { Send, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentQuestionDrawer } from "./AgentQuestionDrawer";
import { PlanApprovalBar } from "./PlanApprovalBar";
import { ToolPermissionPrompt } from "./ToolPermissionPrompt";
import type { PendingPermission } from "./ToolPermissionPrompt";
import { ImageAttachmentPreview } from "./ImageAttachmentPreview";
import { ImageAttachmentButton } from "./ImageAttachmentButton";
import { SplitSendActions } from "./SplitSendActions";
import { PromptEditor } from "./prompt-editor/PromptEditor";
import type { PromptEditorHandle } from "./prompt-editor/PromptEditor";
import { useImageAttachments } from "@/hooks/useImageAttachments";
import { usePromptDraft } from "@/hooks/usePromptDraft";
import { usePromptHistory } from "@/hooks/usePromptHistory";
import { useListFiles } from "@/api/generated";
import type { AgentQuestion, AgentQuestionAnswers } from "./AgentQuestionDrawer";
import type { AgentStatus } from "@/types/agent";

export interface SplitSendAction {
  label: string;
  icon: React.ReactNode;
  onClick: (
    text: string,
    images?: Array<{ base64: string; mimeType: string }>,
  ) => void;
  variant?: "default" | "outline";
  kbdShortcut?: string[];
}

interface AgentPromptBarProps {
  onSend: (
    message: string,
    images?: Array<{ base64: string; mimeType: string }>,
  ) => void;
  onStop: () => void;
  status: AgentStatus;
  splitSendActions?: SplitSendAction[];
  disabled?: boolean;
  pendingQuestions?: AgentQuestion[];
  onQuestionResponse?: (response: AgentQuestionAnswers) => void;
  disableShortcuts?: boolean;
  onCollapse?: () => void;
  permissionMode?: "acceptEdits" | "plan";
  onPermissionModeToggle?: () => void;
  pendingPlanApproval?: {
    allowedPrompts?: Array<{ tool: string; prompt: string }>;
  } | null;
  planApproveLabel?: string;
  planApprovalError?: string | null;
  onPlanApprove?: () => void;
  onPlanRequestChanges?: (feedback: string) => void;
  onPlanReject?: () => void;
  onCycleModel?: () => void;
  featureId?: number;
  projectId?: number;
  sessionId?: number;
  /** WS store key (e.g. "ws-feature-123") for WS-based history and draft persistence. */
  wsSessionId?: string;
  initialDraft?: string | null;
  onToggleMaximize?: () => void;
  noTopPadding?: boolean;
  slashCommandsOverride?: import("@/hooks/useSlashCommand").SlashCommand[];
  slashCommandsLoading?: boolean;
  pendingPermission?: PendingPermission | null;
  onPermissionDecision?: (decision: "allow_once" | "allow_future" | "deny", feedback?: string) => void;
}

export interface AgentPromptBarHandle {
  focusInput: () => void;
}

export const AgentPromptBar = forwardRef<
  AgentPromptBarHandle,
  AgentPromptBarProps
>(function AgentPromptBar(
  {
    onSend,
    onStop,
    status,
    splitSendActions,
    disabled,
    pendingQuestions,
    onQuestionResponse,
    disableShortcuts,
    onCollapse,
    onPermissionModeToggle,
    pendingPlanApproval,
    planApproveLabel,
    planApprovalError,
    onPlanApprove,
    onPlanRequestChanges,
    onPlanReject,
    onCycleModel,
    featureId,
    projectId,
    sessionId,
    wsSessionId,
    initialDraft,
    onToggleMaximize,
    noTopPadding,
    slashCommandsOverride,
    slashCommandsLoading,
    pendingPermission,
    onPermissionDecision,
  },
  ref,
) {
  const editorRef = useRef<PromptEditorHandle>(null);
  const [text, setText] = useState(initialDraft ?? "");
  const textRef = useRef(text);
  textRef.current = text;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  // Suppress resetNavigation when editor text changes from history navigation
  const navigatingHistoryRef = useRef(false);

  const { initialDraft: restoredDraft, saveDraft } = usePromptDraft({ sessionId, wsSessionId, initialDraft: initialDraft ?? null });

  // When a draft is restored from DB after mount, set the editor text
  useEffect(() => {
    if (restoredDraft && !textRef.current) {
      setText(restoredDraft);
      editorRef.current?.setText(restoredDraft);
    }
  }, [restoredDraft]);
  const history = usePromptHistory(projectId ?? 0, wsSessionId);
  const {
    attachments, addFiles, removeAttachment, clearAttachments,
    dragHandlers, isDragging,
  } = useImageAttachments();

  const filesQuery = useListFiles(
    { featureId: featureId! },
    { enabled: !!featureId },
  );

  useImperativeHandle(ref, () => ({
    focusInput: () => editorRef.current?.focus(),
  }));

  // Per-agent UI reads per-agent state — see AgentSession.tsx for the rationale.
  const isRunning = status === "running";
  const isPaused = status === "paused";
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled;

  // Collect images for send
  const getImages = useCallback(() => {
    return attachments.length > 0
      ? attachments.map((a) => ({ base64: a.base64, mimeType: a.mimeType }))
      : undefined;
  }, [attachments]);

  const handleSend = useCallback(() => {
    const trimmed = textRef.current.trim();
    if (!trimmed && attachments.length === 0) return;
    if (projectId) history.addEntry(trimmed);
    saveDraft(null);
    onSend(trimmed, getImages());
    setText("");
    editorRef.current?.clear();
    requestAnimationFrame(() => editorRef.current?.focus());
    clearAttachments();
  }, [attachments, onSend, clearAttachments, projectId, history, saveDraft, getImages]);

  const handleSplitAction = useCallback(
    (action: SplitSendAction) => {
      const trimmed = textRef.current.trim();
      if (!trimmed && attachments.length === 0) return;
      action.onClick(trimmed, getImages());
      setText("");
      editorRef.current?.clear();
      requestAnimationFrame(() => editorRef.current?.focus());
      clearAttachments();
      saveDraft(null);
    },
    [attachments, clearAttachments, saveDraft, getImages],
  );

  // Enter-to-send handler for Lexical
  const handleEnterSend = useCallback(() => {
    const trimmed = textRef.current.trim();
    const hasContent = trimmed.length > 0 || attachments.length > 0;
    if (!hasContent || disabledRef.current) return true; // consume but don't send
    if (splitSendActions && splitSendActions.length > 0) {
      handleSplitAction(splitSendActions[0]);
    } else {
      handleSend();
    }
    return true;
  }, [attachments, splitSendActions, handleSplitAction, handleSend]);

  // Editor text change → draft persistence
  const handleEditorChange = useCallback(
    (newText: string) => {
      setText(newText);
      if (navigatingHistoryRef.current) {
        navigatingHistoryRef.current = false;
        return;
      }
      saveDraft(newText);
      history.resetNavigation();
    },
    [saveDraft, history],
  );

  // History navigation callbacks
  const handleArrowUp = useCallback(() => {
    if (!projectId || !wsSessionId) return null;
    const result = history.navigateUp(textRef.current);
    if (result !== null) navigatingHistoryRef.current = true;
    return result;
  }, [projectId, wsSessionId, history]);

  const handleArrowDown = useCallback(() => {
    if (!projectId || !wsSessionId || history.historyIndex < 0) return null;
    const result = history.navigateDown();
    if (result !== null) navigatingHistoryRef.current = true;
    return result;
  }, [projectId, wsSessionId, history]);

  // Keyboard shortcuts via react-hotkeys-hook on wrapper
  const wrapperRef = useRef<HTMLDivElement>(null);

  useHotkeys("meta+p", (e) => {
    if (!onCycleModel) return;
    e.preventDefault();
    onCycleModel();
  }, { enableOnFormTags: true, enableOnContentEditable: true });

  useHotkeys("meta+enter", (e) => {
    if (!onToggleMaximize) return;
    e.preventDefault();
    onToggleMaximize();
  }, { enableOnFormTags: true, enableOnContentEditable: true });

  useHotkeys("shift+tab", (e) => {
    if (!onPermissionModeToggle) return;
    e.preventDefault();
    onPermissionModeToggle();
  }, { enableOnFormTags: true, enableOnContentEditable: true });

  useHotkeys("meta+shift+z", (e) => {
    if (isRunning || !onCollapse) return;
    e.preventDefault();
    onCollapse();
  }, { enableOnFormTags: true, enableOnContentEditable: true });

  useHotkeys("escape", (e) => {
    if (!isRunning) return;
    if (!wrapperRef.current?.contains(document.activeElement)) return;
    e.preventDefault();
    onStop();
  }, { enableOnFormTags: true, enableOnContentEditable: true });

  // Early returns for special states
  if (pendingPermission && onPermissionDecision) {
    return (
      <div data-question-area>
        <ToolPermissionPrompt
          permission={pendingPermission}
          onDecision={onPermissionDecision}
          disableShortcuts={disableShortcuts}
        />
      </div>
    );
  }

  if (pendingPlanApproval && onPlanApprove && onPlanRequestChanges) {
    return (
      <div data-question-area>
        <PlanApprovalBar
          allowedPrompts={pendingPlanApproval.allowedPrompts}
          approveLabel={planApproveLabel}
          onApprove={onPlanApprove}
          onRequestChanges={onPlanRequestChanges}
          onReject={onPlanReject}
          error={planApprovalError}
        />
      </div>
    );
  }

  if (!!pendingQuestions && pendingQuestions.length > 0 && onQuestionResponse) {
    return (
      <div data-question-area>
        <AgentQuestionDrawer
          questions={pendingQuestions}
          open={true}
          onSubmit={onQuestionResponse}
          inline
          disableShortcuts={disableShortcuts}
        />
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "flex flex-col px-3 pb-4",
        noTopPadding ? "pt-0" : "pt-3",
        isDragging && "ring-2 ring-primary/50 ring-inset",
      )}
      {...dragHandlers}
    >
      {attachments.length > 0 && (
        <ImageAttachmentPreview
          attachments={attachments}
          onRemove={removeAttachment}
          className="mb-2"
        />
      )}

      <div className="flex items-center gap-1.5 rounded-lg bg-muted/40 py-4 pl-4 pr-2.5 transition-colors focus-within:bg-muted/55">
        <PromptEditor
          ref={editorRef}
          onChange={handleEditorChange}
          onEnterSend={handleEnterSend}
          onArrowUp={handleArrowUp}
          onArrowDown={handleArrowDown}
          disabled={disabled}
          placeholder={
            isPaused
              ? "Send a message to resume…"
              : "Send a message… (@ to mention files, / for commands)"
          }
          className="max-h-32 min-h-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-0 py-0 text-sm leading-[22px] shadow-none focus:border-0 focus:ring-0"
          mentionFiles={filesQuery.data}
          slashCommands={slashCommandsOverride}
          slashCommandsLoading={slashCommandsLoading}
          initialText={initialDraft ?? undefined}
        />

        <div className="flex shrink-0 items-center gap-1.5 self-end">
          <ImageAttachmentButton onFilesSelected={addFiles} />

          {isRunning ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop agent"
              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-destructive/15 text-destructive transition-colors hover:bg-destructive/25"
            >
              <Pause className="size-3.5" />
            </button>
          ) : !splitSendActions ? (
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send message"
              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
            >
              <Send className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {splitSendActions && !isRunning && (
        <SplitSendActions
          actions={splitSendActions}
          disabled={!canSend}
          onAction={handleSplitAction}
        />
      )}
    </div>
  );
});
