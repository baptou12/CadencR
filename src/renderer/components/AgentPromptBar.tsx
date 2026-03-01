import { useState, useCallback, useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { Send, Square, Zap, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AgentQuestionDrawer } from "./AgentQuestionDrawer";
import { PlanApprovalBar } from "./PlanApprovalBar";
import { FileMentionPopover } from "./FileMentionPopover";
import { SlashCommandPopover } from "./SlashCommandPopover";
import { ImageAttachmentPreview } from "./ImageAttachmentPreview";
import { ImageAttachmentButton } from "./ImageAttachmentButton";
import { useFileMention } from "@/hooks/useFileMention";
import { useSlashCommand } from "@/hooks/useSlashCommand";
import { useImageAttachments } from "@/hooks/useImageAttachments";
import { usePromptDraft } from "@/hooks/usePromptDraft";
import { usePromptHistory } from "@/hooks/usePromptHistory";
import { KbdShortcut } from "./KbdShortcut";
import { trpc } from "@/trpc";
import type { AgentQuestion } from "./AgentQuestionDrawer";
import type { AgentStatus } from "@/components/AgentSession";

export interface SplitSendAction {
  label: string;
  icon: React.ReactNode;
  onClick: (text: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  variant?: "default" | "outline";
  /** Keyboard shortcut keys to display on the button */
  kbdShortcut?: string[];
}

export interface AgentPromptBarProps {
  onSend: (message: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  onStop: () => void;
  status: AgentStatus;
  /** When provided, replaces the single send button with multiple labeled action buttons */
  splitSendActions?: SplitSendAction[];
  disabled?: boolean;
  /** Active questions from AskUserQuestion tool calls */
  pendingQuestions?: AgentQuestion[];
  /** Called when the user submits a response to questions */
  onQuestionResponse?: (response: string) => void;
  /** When true, disables keyboard shortcuts in the question drawer */
  disableShortcuts?: boolean;
  /** Called when the textarea gains or loses focus */
  onFocusChange?: (focused: boolean) => void;
  /** Called when CMD+SHIFT+Z is pressed to collapse the agent */
  onCollapse?: () => void;
  /** Current permission mode (session agents only) */
  permissionMode?: "acceptEdits" | "plan";
  /** Called when user toggles permission mode */
  onPermissionModeToggle?: () => void;
  /** Pending plan approval from ExitPlanMode tool call */
  pendingPlanApproval?: { allowedPrompts?: Array<{ tool: string; prompt: string }> } | null;
  /** Label for the approve button (defaults to "Approve & Execute") */
  planApproveLabel?: string;
  /** Error message from a failed plan approval attempt */
  planApprovalError?: string | null;
  /** Called when user approves the plan */
  onPlanApprove?: () => void;
  /** Called when user requests changes to the plan */
  onPlanRequestChanges?: (feedback: string) => void;
  /** Called when CMD+P is pressed to cycle model */
  onCycleModel?: () => void;
  /** Feature ID for file mention and slash command support */
  featureId?: number;
  /** Project ID for slash command support and prompt history */
  projectId?: number;
  /** Agent session DB ID for draft persistence */
  sessionId?: number;
  /** Initial draft text (restored from DB) */
  initialDraft?: string | null;
  /** Active subprocess ID for slash command support */
  subprocessId?: string;
  /** Called when CMD+Enter is pressed to toggle maximize */
  onToggleMaximize?: () => void;
}

/** Handle exposed by AgentPromptBar via forwardRef */
export interface AgentPromptBarHandle {
  /** Focus the textarea input */
  focusInput: () => void;
}

export const AgentPromptBar = forwardRef<AgentPromptBarHandle, AgentPromptBarProps>(function AgentPromptBar({
  onSend,
  onStop,
  status,
  splitSendActions,
  disabled,
  pendingQuestions,
  onQuestionResponse,
  disableShortcuts,
  onFocusChange,
  onCollapse,
  permissionMode,
  onPermissionModeToggle,
  pendingPlanApproval,
  planApproveLabel,
  planApprovalError,
  onPlanApprove,
  onPlanRequestChanges,
  onCycleModel,
  featureId,
  projectId,
  sessionId,
  initialDraft,
  subprocessId,
  onToggleMaximize,
}, ref) {
  const [text, setText] = useState(initialDraft ?? "");

  // Draft persistence
  const { saveDraft } = usePromptDraft({ sessionId, initialDraft: initialDraft ?? null });

  // Prompt history (only when projectId is available)
  const history = usePromptHistory(projectId ?? 0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { attachments, addFiles, removeAttachment, clearAttachments, dragHandlers, isDragging } = useImageAttachments();

  // File mention support
  const filesQuery = trpc.git.listFiles.useQuery(
    { featureId: featureId! },
    { enabled: !!featureId },
  );
  const mention = useFileMention(filesQuery.data ?? undefined);

  // Slash command support
  const slashEnabled = !!featureId && !!projectId;
  const commandsQuery = trpc.sessions.getSupportedCommands.useQuery(
    { subprocessId: subprocessId ?? null, featureId: featureId!, projectId: projectId! },
    { enabled: slashEnabled },
  );
  const slash = useSlashCommand(commandsQuery.data ?? undefined);

  useImperativeHandle(ref, () => ({
    focusInput: () => {
      textareaRef.current?.focus({ focusVisible: true } as FocusOptions);
    },
  }));

  // CMD+P — cycle model (replaces OPT+SHIFT+P)
  useHotkeys(
    "meta+p",
    (e) => {
      if (!onCycleModel) return;
      e.preventDefault();
      onCycleModel();
    },
    { enableOnFormTags: true },
  );

  const isRunning = status === "running";
  const isPaused = status === "paused";
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled;
  const hasQuestions = !!pendingQuestions && pendingQuestions.length > 0;

  // Auto-resize textarea to fit content
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (projectId) history.addEntry(trimmed);
    saveDraft(null);
    const images = attachments.length > 0
      ? attachments.map((a) => ({ base64: a.base64, mimeType: a.mimeType }))
      : undefined;
    onSend(trimmed, images);
    setText("");
    clearAttachments();
  }, [text, attachments, onSend, clearAttachments, projectId, history, saveDraft]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Slash command handles keys first when its popover is open
      const slashResult = slash.handleKeyDown(e, text);
      if (slashResult === true) return;
      if (typeof slashResult === "object") {
        setText(slashResult.newText);
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (el) {
            el.selectionStart = slashResult.newCursorPos;
            el.selectionEnd = slashResult.newCursorPos;
          }
        });
        return;
      }

      // File mention handles keys when its popover is open
      const mentionResult = mention.handleKeyDown(e, text);
      if (mentionResult === true) return; // event consumed, no text change
      if (typeof mentionResult === "object") {
        // Mention confirmed — update text and cursor
        setText(mentionResult.newText);
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (el) {
            el.selectionStart = mentionResult.newCursorPos;
            el.selectionEnd = mentionResult.newCursorPos;
          }
        });
        return;
      }

      if (e.key === "ArrowUp" && !e.metaKey && !e.altKey && text.trim() === "" && projectId) {
        const result = history.navigateUp(text);
        if (result !== null) {
          e.preventDefault();
          setText(result);
        }
        return;
      } else if (e.key === "ArrowDown" && !e.metaKey && !e.altKey && history.historyIndex >= 0 && projectId) {
        const result = history.navigateDown();
        if (result !== null) {
          e.preventDefault();
          setText(result);
        }
        return;
      }

      if (e.key === "Enter" && e.metaKey && onToggleMaximize) {
        e.preventDefault();
        onToggleMaximize();
      } else if (e.key === "Tab" && e.shiftKey && onPermissionModeToggle) {
        e.preventDefault();
        onPermissionModeToggle();
      } else if (e.key === "z" && e.metaKey && e.shiftKey && !isRunning && onCollapse) {
        e.preventDefault();
        onCollapse();
      } else if (e.key === "Escape" && isRunning) {
        e.preventDefault();
        onStop();
      } else if (e.key === "Enter" && !e.shiftKey && canSend) {
        e.preventDefault();
        if (splitSendActions && splitSendActions.length > 0) {
          const trimmed = text.trim();
          const images = attachments.length > 0
            ? attachments.map((a) => ({ base64: a.base64, mimeType: a.mimeType }))
            : undefined;
          splitSendActions[0].onClick(trimmed, images);
          setText("");
          clearAttachments();
          saveDraft(null);
        } else {
          handleSend();
        }
      } else if (e.key === "Enter" && !e.shiftKey && !canSend) {
        e.preventDefault();
      }
    },
    [canSend, handleSend, isRunning, onStop, onCollapse, onPermissionModeToggle, onToggleMaximize, mention, slash, text, projectId, history, splitSendActions, attachments, clearAttachments, saveDraft],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setText(newValue);
      saveDraft(newValue);
      history.resetNavigation();
      mention.handleChange(newValue, e.target.selectionStart);
      slash.handleChange(newValue, e.target.selectionStart);
    },
    [mention, slash, saveDraft, history],
  );

  const handleSlashSelect = useCallback(
    (commandName: string) => {
      const result = slash.confirm(text, commandName);
      if (result) {
        setText(result.newText);
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (el) {
            el.selectionStart = result.newCursorPos;
            el.selectionEnd = result.newCursorPos;
            el.focus();
          }
        });
      }
    },
    [slash, text],
  );

  const handleMentionSelect = useCallback(
    (path: string) => {
      const result = mention.confirm(text, path);
      if (result) {
        setText(result.newText);
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (el) {
            el.selectionStart = result.newCursorPos;
            el.selectionEnd = result.newCursorPos;
            el.focus();
          }
        });
      }
    },
    [mention, text],
  );

  // When plan approval is pending, render the approval bar instead of the prompt input
  if (pendingPlanApproval && onPlanApprove && onPlanRequestChanges) {
    return (
      <div data-question-area>
        <PlanApprovalBar
          allowedPrompts={pendingPlanApproval.allowedPrompts}
          approveLabel={planApproveLabel}
          onApprove={onPlanApprove}
          onRequestChanges={onPlanRequestChanges}
          error={planApprovalError}
        />
      </div>
    );
  }

  // When questions are pending, render the question form inline instead of the prompt input
  if (hasQuestions && onQuestionResponse) {
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
      className={cn("flex flex-col bg-muted/20 px-3 py-2", isDragging && "ring-2 ring-primary/50 ring-inset")}
      {...dragHandlers}
    >
      {attachments.length > 0 && (
        <ImageAttachmentPreview attachments={attachments} onRemove={removeAttachment} className="mb-2" />
      )}
      <div className="flex items-center gap-2">
      {onPermissionModeToggle && (
        <button
          type="button"
          onClick={onPermissionModeToggle}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
            permissionMode === "plan"
              ? "bg-green-500/15 text-green-400 hover:bg-green-500/25"
              : "bg-blue-500/15 text-blue-400 hover:bg-blue-500/25",
          )}
          title="Toggle permission mode (Shift+Tab)"
        >
          {permissionMode === "plan" ? (
            <>
              <ClipboardList className="size-3.5" />
              Plan
            </>
          ) : (
            <>
              <Zap className="size-3.5" />
              Auto
            </>
          )}
        </button>
      )}
      <FileMentionPopover
        open={mention.isOpen && !slash.isOpen}
        items={mention.filteredItems}
        selectedIndex={mention.selectedIndex}
        onSelect={handleMentionSelect}
        onClose={mention.close}
      >
        <SlashCommandPopover
          open={slash.isOpen && !mention.isOpen}
          items={slash.filteredItems}
          selectedIndex={slash.selectedIndex}
          onSelect={handleSlashSelect}
          isLoading={commandsQuery.isLoading || commandsQuery.isFetching}
        >
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => onFocusChange?.(true)}
            onBlur={() => onFocusChange?.(false)}
            placeholder={isPaused ? "Send a message to resume…" : "Send a message… (@ to mention files, / for commands, 📎 to attach images)"}
            disabled={disabled}
            rows={1}
            className="max-h-32 min-h-[42px] resize-none overflow-hidden border-border/50 bg-background py-2.5 text-sm leading-[22px] shadow-none focus-visible:ring-1 focus-visible:ring-ring/40"
          />
        </SlashCommandPopover>
      </FileMentionPopover>
      <ImageAttachmentButton onFilesSelected={addFiles} />
      {isRunning ? (
        <Button
          variant="destructive"
          size="icon"
          onClick={onStop}
          aria-label="Stop agent"
          className="h-[42px] w-[42px] shrink-0"
        >
          <Square className="size-3.5" />
        </Button>
      ) : !splitSendActions ? (
        <Button
          variant="default"
          size="icon"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
          className="h-[42px] w-[42px] shrink-0"
        >
          <Send className="size-3.5" />
        </Button>
      ) : null}
      </div>
      {splitSendActions && !isRunning && (
        <div className="flex flex-col gap-1.5 pt-1">
          {splitSendActions.map((action, i) => (
            <Button
              key={i}
              variant={action.variant ?? "default"}
              size="sm"
              onClick={() => {
                const trimmed = text.trim();
                if (!trimmed && attachments.length === 0) return;
                const images = attachments.length > 0
                  ? attachments.map((a) => ({ base64: a.base64, mimeType: a.mimeType }))
                  : undefined;
                action.onClick(trimmed, images);
                setText("");
                clearAttachments();
                saveDraft(null);
              }}
              disabled={!canSend}
            >
              {action.icon}
              {action.label}
              {action.kbdShortcut && <KbdShortcut keys={action.kbdShortcut} />}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
});
