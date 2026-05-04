import { useState, useCallback, useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useScopedHotkeys } from "@/hooks/useScopedHotkeys";
import { Loader2, Send, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentQuestionDrawer } from "./AgentQuestionDrawer";
import { PlanApprovalBar } from "./PlanApprovalBar";
import { ToolPermissionPrompt } from "./ToolPermissionPrompt";
import { ImageAttachmentPreview } from "./ImageAttachmentPreview";
import { ImageAttachmentButton } from "./ImageAttachmentButton";
import { SplitSendActions } from "./SplitSendActions";
import { PromptEditor } from "./prompt-editor/PromptEditor";
import type { PromptEditorHandle } from "./prompt-editor/PromptEditor";
import { shouldFocusPromptFromSurfaceClick } from "./agent-prompt-focus";
import { useImageAttachments } from "@/hooks/useImageAttachments";
import { usePromptDraft } from "@/hooks/usePromptDraft";
import { usePromptHistory } from "@/hooks/usePromptHistory";
import { useListFiles } from "@/api/generated";
import { useAgentPromptSend } from "./agent-prompt-send";
import type {
  AgentPromptBarHandle,
  AgentPromptBarProps,
  SplitSendAction,
} from "./agent-prompt-bar-types";

export type { AgentPromptBarHandle, SplitSendAction } from "./agent-prompt-bar-types";

export const AgentPromptBar = forwardRef<AgentPromptBarHandle, AgentPromptBarProps>(
  function AgentPromptBar(
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
      planFeedbackDefault,
      planApproveLabel,
      planApprovalError,
      onPlanApprove,
      onPlanRequestChanges,
      onPlanReject,
      onOpenModelPicker,
      agentTabActive = true,
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
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [text, setText] = useState(initialDraft ?? "");
    const textRef = useRef(text);
    textRef.current = text;
    const disabledRef = useRef(disabled);
    disabledRef.current = disabled;
    const navigatingHistoryRef = useRef(false);
    const hadSpecialStateRef = useRef(false);
    const shouldRestoreFocusRef = useRef(false);

    const { initialDraft: restoredDraft, saveDraft } = usePromptDraft({
      sessionId,
      wsSessionId,
      initialDraft: initialDraft ?? null,
    });

    useEffect(() => {
      if (restoredDraft && !textRef.current) {
        setText(restoredDraft);
        editorRef.current?.setText(restoredDraft);
      }
    }, [restoredDraft]);

    const hasSpecialState =
      !!pendingPermission ||
      !!pendingPlanApproval ||
      (!!pendingQuestions && pendingQuestions.length > 0);

    useEffect(() => {
      if (hasSpecialState) {
        hadSpecialStateRef.current = true;
        shouldRestoreFocusRef.current = !!wrapperRef.current?.contains(document.activeElement);
        return;
      }
      if (!hadSpecialStateRef.current) return;
      hadSpecialStateRef.current = false;
      if (!shouldRestoreFocusRef.current) return;
      shouldRestoreFocusRef.current = false;
      requestAnimationFrame(() => editorRef.current?.focus());
    }, [hasSpecialState]);

    const history = usePromptHistory(projectId ?? 0, wsSessionId);
    const {
      attachments,
      addFiles,
      removeAttachment,
      clearAttachments,
      restoreAttachments,
      dragHandlers,
      isDragging,
    } = useImageAttachments();

    const filesQuery = useListFiles(
      { feature_id: featureId! },
      { query: { enabled: !!featureId && agentTabActive && !disabled } },
    );

    useImperativeHandle(ref, () => ({
      focusInput: () => editorRef.current?.focus(),
    }));

    // Map the canonical 3-value status onto the legacy boolean flags the
    // rest of this file uses. `agent` is the working state (analogous to
    // the old "running"); `question` is a pause that the user must answer
    // (analogous to the old "paused"). `idle` covers everything else
    // (completed/error/never-started — all UI-equivalent here).
    const isRunning = status === "agent";
    const isPaused = status === "question";
    const getAttachments = useCallback(() => attachments, [attachments]);
    const addHistoryEntry = useCallback(
      (entry: string) => {
        if (projectId) history.addEntry(entry);
      },
      [projectId, history],
    );
    // `useAgentPromptSend` owns the await-and-restore-on-failure dance plus
    // the `sending` busy flag. Per `explicit-state.md`, the busy flag drives
    // a visible spinner on the send button so the user never stares at a
    // frozen prompt while async pre-send work (e.g. saving worktree
    // settings) is in flight.
    const { sending, runSend } = useAgentPromptSend({
      editorRef,
      setText,
      clearAttachments,
      restoreAttachments,
      saveDraft,
      addHistoryEntry,
      getAttachments,
    });
    const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled && !sending;

    const handleSend = useCallback(() => {
      const trimmed = textRef.current.trim();
      if (!trimmed && attachments.length === 0) return;
      void runSend(onSend, trimmed);
    }, [attachments, onSend, runSend]);
    const handleSplitAction = useCallback(
      (action: SplitSendAction) => {
        const trimmed = textRef.current.trim();
        if (!trimmed && attachments.length === 0) return;
        void runSend(action.onClick, trimmed);
      },
      [attachments, runSend],
    );
    const handleEnterSend = useCallback(() => {
      const trimmed = textRef.current.trim();
      const hasContent = trimmed.length > 0 || attachments.length > 0;
      if (!hasContent || disabledRef.current || sending) return true; // consume but don't send
      if (splitSendActions && splitSendActions.length > 0) {
        handleSplitAction(splitSendActions[0]);
      } else {
        handleSend();
      }
      return true;
    }, [attachments, sending, splitSendActions, handleSplitAction, handleSend]);

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

    const handlePromptSurfaceClick = useCallback(
      (event: React.MouseEvent<HTMLDivElement>): void => {
        if (!shouldFocusPromptFromSurfaceClick(event.target)) return;
        editorRef.current?.focus();
      },
      [],
    );

    // Agent-menu shortcuts. `useScopedHotkeys` gates them on the active tab
    // when rendered inside a FeatureLayoutProvider; otherwise it's a no-op
    // gate (used by tests / standalone usage). The legacy `agentTabActive`
    // prop is composed via `enabled` so existing parents that haven't yet
    // adopted the context still get correct gating. `enableOnFormTags` /
    // `enableOnContentEditable` keep them firing while the user is typing in
    // the prompt editor (a contenteditable) — its primary trigger surface.
    const hotkeyOpts = {
      enabled: agentTabActive,
      enableOnFormTags: true as const,
      enableOnContentEditable: true,
    };
    useScopedHotkeys(
      "meta+p",
      (e) => {
        if (!onOpenModelPicker) return;
        e.preventDefault();
        onOpenModelPicker();
      },
      "agent",
      hotkeyOpts,
    );

    useScopedHotkeys(
      "meta+enter",
      (e) => {
        if (!onToggleMaximize) return;
        e.preventDefault();
        onToggleMaximize();
      },
      "agent",
      hotkeyOpts,
    );

    useScopedHotkeys(
      "shift+tab",
      (e) => {
        if (!onPermissionModeToggle) return;
        e.preventDefault();
        onPermissionModeToggle();
      },
      "agent",
      hotkeyOpts,
    );

    useScopedHotkeys(
      "meta+shift+z",
      (e) => {
        if (isRunning || !onCollapse) return;
        e.preventDefault();
        onCollapse();
      },
      "agent",
      hotkeyOpts,
    );

    useHotkeys(
      "escape",
      (e) => {
        if (!isRunning) return;
        if (!wrapperRef.current?.contains(document.activeElement)) return;
        e.preventDefault();
        onStop();
      },
      { enableOnFormTags: true, enableOnContentEditable: true },
      [isRunning, onStop],
    );

    const specialPrompt =
      pendingPermission && onPermissionDecision ? (
        <ToolPermissionPrompt
          permission={pendingPermission}
          onDecision={onPermissionDecision}
          disableShortcuts={disableShortcuts}
        />
      ) : pendingPlanApproval && onPlanApprove && onPlanRequestChanges ? (
        <PlanApprovalBar
          allowedPrompts={pendingPlanApproval.allowedPrompts}
          initialFeedback={planFeedbackDefault}
          approveLabel={planApproveLabel}
          onApprove={onPlanApprove}
          onRequestChanges={onPlanRequestChanges}
          onReject={onPlanReject}
          error={planApprovalError}
        />
      ) : !!pendingQuestions && pendingQuestions.length > 0 && onQuestionResponse ? (
        <AgentQuestionDrawer
          questions={pendingQuestions}
          open={true}
          onSubmit={onQuestionResponse}
          inline
          disableShortcuts={disableShortcuts}
        />
      ) : null;

    return (
      <>
        {specialPrompt && <div data-question-area>{specialPrompt}</div>}
        <div
          ref={wrapperRef}
          data-agent-prompt-bar="true"
          hidden={hasSpecialState}
          aria-hidden={hasSpecialState}
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

          <div
            className="flex items-center gap-1.5 rounded-lg bg-muted/40 py-4 pl-4 pr-2.5 transition-colors focus-within:bg-muted/55"
            onClick={handlePromptSurfaceClick}
          >
            <PromptEditor
              ref={editorRef}
              onChange={handleEditorChange}
              onEnterSend={handleEnterSend}
              onArrowUp={handleArrowUp}
              onArrowDown={handleArrowDown}
              disabled={disabled || sending}
              placeholder={
                isPaused
                  ? "Send a message to resume…"
                  : "Send a message… (@ to mention files, / for commands)"
              }
              className="max-h-32 min-h-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-0 py-0 text-sm leading-[22px] shadow-none focus:border-0 focus:ring-0"
              mentionFiles={filesQuery.data}
              slashCommands={slashCommandsOverride}
              slashCommandsLoading={slashCommandsLoading}
              initialText={initialDraft || undefined}
            />

            <div className="flex shrink-0 items-center gap-1.5 self-end">
              <ImageAttachmentButton onFilesSelected={addFiles} disabled={disabled || sending} />

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
                  aria-busy={sending}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
                >
                  {sending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Send className="size-3.5" />
                  )}
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
      </>
    );
  },
);
