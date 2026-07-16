import { useState, useCallback, useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { cn } from "@/lib/utils";
import { AgentQuestionDrawer } from "./AgentQuestionDrawer";
import { PlanApprovalBar } from "./PlanApprovalBar";
import { ToolPermissionPrompt } from "./ToolPermissionPrompt";
import { AgentPromptPendingIndicator } from "./AgentPromptPendingIndicator";
import { ImageAttachmentPreview } from "./ImageAttachmentPreview";
import { PromptBarActions } from "./PromptBarActions";
import { SplitSendActions } from "./SplitSendActions";
import { ShellCommandModeMarker } from "./ShellCommandModeMarker";
import { PromptEditor } from "./prompt-editor/PromptEditor";
import type { PromptEditorHandle } from "./prompt-editor/PromptEditor";
import { shouldFocusPromptFromSurfaceClick } from "./agent-prompt-focus";
import { usePromptAttachments } from "@/hooks/usePromptAttachments";
import { usePromptDraft } from "@/hooks/usePromptDraft";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePromptHistory } from "@/hooks/usePromptHistory";
import { usePromptScheduleControl } from "@/hooks/usePromptScheduleControl";
import { useAgentPromptShortcuts } from "@/hooks/useAgentPromptShortcuts";
import { useAgentPromptSend } from "./agent-prompt-send";
import { useFeaturePromptDraftRestore } from "./agent-prompt-draft-restore";
import { useDeferredAgentPrompts } from "./useDeferredAgentPrompts";
import {
  DEFAULT_PROMPT_COMMAND_POLICY,
  supportsDollarSkillReferences,
} from "@/lib/prompt-command-policy";
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
      onSchedule,
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
      onGateClose,
      onOpenModelPicker,
      agentTabActive = true,
      featureId,
      projectId,
      sessionId,
      wsSessionId,
      providerId,
      onToggleMaximize,
      noTopPadding,
      slashCommandsOverride,
      slashCommandsLoading,
      promptCommandPolicy = DEFAULT_PROMPT_COMMAND_POLICY,
      pendingPermission,
      onPermissionDecision,
      isSubmittingPermission,
    },
    ref,
  ) {
    const editorRef = useRef<PromptEditorHandle>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const isMobile = useIsMobile();
    const promptCommandHint = [
      "/ commands",
      supportsDollarSkillReferences(promptCommandPolicy) ? "$ skills" : undefined,
      promptCommandPolicy.userShell ? "! shell" : undefined,
    ]
      .filter((hint): hint is string => !!hint)
      .join(", ");
    const [text, setText] = useState("");
    const isShellCommandMode = promptCommandPolicy.userShell && text.startsWith("!");
    const textRef = useRef(text);
    textRef.current = text;
    const navigatingHistoryRef = useRef(false);
    const restoringDraftRef = useRef(false);
    // Set once the user types in or sends from this feature; reset on feature
    // switch by the draft-restore hook. Gates draft auto-restore so a late
    // query refetch can't re-inject text the user already sent.
    const interactedRef = useRef(false);
    const hadSpecialStateRef = useRef(false);
    const shouldRestoreFocusRef = useRef(false);
    const {
      initialDraft: restoredDraft,
      draftFeatureId,
      saveDraft,
    } = usePromptDraft({
      featureId,
    });
    useFeaturePromptDraftRestore({
      featureId,
      restoredDraft,
      draftFeatureId,
      textRef,
      editorRef,
      restoringDraftRef,
      interactedRef,
      setText,
      isMobile,
    });
    const {
      visiblePermission,
      visiblePlanApproval,
      visibleQuestions,
      permissionDeferred,
      planApprovalDeferred,
      questionsDeferred,
    } = useDeferredAgentPrompts({
      pendingPermission,
      pendingPlanApproval,
      pendingQuestions,
      promptText: text,
    });
    const hasSpecialState =
      !!visiblePermission ||
      !!visiblePlanApproval ||
      (!!visibleQuestions && visibleQuestions.length > 0);
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
    } = usePromptAttachments({ wsSessionId, sessionId, featureId, providerId });
    useImperativeHandle(ref, () => ({
      focusInput: () => editorRef.current?.focus(),
      setDraft: (value: string) => {
        // Mirror the draft-restore path: flag the restore so the editor's
        // onChange doesn't treat it as a fresh user edit, populate both the
        // editor and the text state, persist, and focus with the caret at end.
        restoringDraftRef.current = true;
        setText(value);
        editorRef.current?.setText(value, true);
        interactedRef.current = true;
        saveDraft(value);
        queueMicrotask(() => {
          restoringDraftRef.current = false;
        });
      },
    }));
    const isRunning = status === "agent";
    const getAttachments = useCallback(() => attachments, [attachments]);
    const addHistoryEntry = useCallback(
      (entry: string) => {
        if (projectId) history.addEntry(entry);
      },
      [projectId, history],
    );
    const { sending, runSend } = useAgentPromptSend({
      editorRef,
      setText,
      clearAttachments,
      restoreAttachments,
      saveDraft,
      addHistoryEntry,
      getAttachments,
      interactedRef,
    });
    const hasSendableContent = isShellCommandMode
      ? text.slice(1).trim().length > 0 && attachments.length === 0
      : text.trim().length > 0 || attachments.length > 0;
    const canSend = hasSendableContent && !disabled && !sending && !permissionDeferred;
    const handleSend = useCallback(() => {
      if (!canSend) return;
      const trimmed = textRef.current.trim();
      void runSend(onSend, trimmed);
    }, [canSend, onSend, runSend]);
    const handleSplitAction = useCallback(
      (action: SplitSendAction) => {
        if (!canSend) return;
        const trimmed = textRef.current.trim();
        void runSend(action.onClick, trimmed);
      },
      [canSend, runSend],
    );
    const scheduleControl = usePromptScheduleControl({
      onSchedule,
      featureId,
      enabled: canSend && text.trim().length > 0,
      textRef,
      editorRef,
      setText,
      saveDraft,
      addHistoryEntry,
      interactedRef,
    });
    const handleEnterSend = useCallback(() => {
      if (!canSend) return true;
      if (!isShellCommandMode && splitSendActions && splitSendActions.length > 0) {
        handleSplitAction(splitSendActions[0]);
      } else {
        handleSend();
      }
      return true;
    }, [canSend, isShellCommandMode, splitSendActions, handleSplitAction, handleSend]);
    const clearShellCommandMode = useCallback(() => {
      editorRef.current?.clearShellCommandMode();
    }, []);
    const handleEditorChange = useCallback(
      (newText: string) => {
        setText(newText);
        if (restoringDraftRef.current) return;
        // A real user edit (typing or history navigation) hands the input to
        // the user, suppressing later draft auto-restore for this feature.
        interactedRef.current = true;
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
    useAgentPromptShortcuts({
      agentTabActive,
      isRunning,
      wrapperRef,
      onOpenModelPicker,
      onToggleMaximize,
      onPermissionModeToggle,
      onCollapse,
      onStop,
    });
    const specialPrompt =
      visiblePermission && onPermissionDecision ? (
        <ToolPermissionPrompt
          key={
            visiblePermission.requestId ??
            `${visiblePermission.toolName}:${visiblePermission.pattern}`
          }
          permission={visiblePermission}
          onDecision={onPermissionDecision}
          onCancel={onGateClose}
          disableShortcuts={disableShortcuts}
          isSubmitting={!!isSubmittingPermission}
        />
      ) : visiblePlanApproval && onPlanApprove && onPlanRequestChanges ? (
        <PlanApprovalBar
          allowedPrompts={visiblePlanApproval.allowedPrompts}
          initialFeedback={text}
          approveLabel={planApproveLabel}
          onApprove={onPlanApprove}
          onRequestChanges={onPlanRequestChanges}
          onReject={onGateClose ?? onPlanReject}
          error={planApprovalError}
        />
      ) : !!visibleQuestions && visibleQuestions.length > 0 && onQuestionResponse ? (
        <AgentQuestionDrawer
          questions={visibleQuestions}
          open={true}
          onSubmit={onQuestionResponse}
          onCancel={onGateClose}
          inline
          disableShortcuts={disableShortcuts}
        />
      ) : null;
    return (
      <>
        {permissionDeferred && pendingPermission && (
          <AgentPromptPendingIndicator kind="permission" detail={pendingPermission.toolName} />
        )}
        {planApprovalDeferred && <AgentPromptPendingIndicator kind="plan" />}
        {questionsDeferred && <AgentPromptPendingIndicator kind="question" />}
        {specialPrompt && (
          <div data-permission-area={!!visiblePermission} data-question-area>
            {specialPrompt}
          </div>
        )}
        <div
          ref={wrapperRef}
          data-agent-prompt-bar="true"
          hidden={hasSpecialState}
          aria-hidden={hasSpecialState}
          className={cn(
            "flex flex-col px-3 pb-4",
            noTopPadding ? "pt-0" : "pt-3",
            "group-data-[agent-dragover]/agent-section:ring-2 group-data-[agent-dragover]/agent-section:ring-inset group-data-[agent-dragover]/agent-section:ring-primary/50",
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
            data-shell-command-mode={isShellCommandMode || undefined}
            className="glass-surface flex items-center gap-1.5 rounded-lg border border-transparent bg-muted/40 py-4 pl-4 pr-2.5 transition-colors focus-within:bg-muted/55"
            onClick={handlePromptSurfaceClick}
          >
            {isShellCommandMode && <ShellCommandModeMarker onClear={clearShellCommandMode} />}
            <PromptEditor
              ref={editorRef}
              onChange={handleEditorChange}
              onEnterSend={handleEnterSend}
              onArrowUp={handleArrowUp}
              onArrowDown={handleArrowDown}
              disabled={disabled || sending}
              placeholder={
                status === "question"
                  ? "Send a message to resume…"
                  : `Send a message… (@ files, @@ conversations, ${promptCommandHint})`
              }
              className="max-h-[40vh] min-h-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-0 py-0 text-sm leading-[22px] shadow-none focus:border-0 focus:ring-0"
              mentionProjectId={projectId}
              mentionFeatureId={featureId}
              slashCommands={slashCommandsOverride}
              slashCommandsLoading={slashCommandsLoading}
              promptCommandPolicy={promptCommandPolicy}
              onPasteImages={addFiles}
            />
            <PromptBarActions
              onAddFiles={addFiles}
              providerId={providerId}
              inputsDisabled={!!disabled || sending || isShellCommandMode}
              isRunning={isRunning}
              onStop={onStop}
              onSend={handleSend}
              canSend={canSend}
              sending={sending}
              showSendButton={(isShellCommandMode || !splitSendActions) && (!isRunning || isMobile)}
              schedule={isShellCommandMode ? undefined : scheduleControl}
            />
          </div>
          {splitSendActions && !isRunning && !isShellCommandMode && (
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
