import { useState, type ReactElement } from "react";
import { useScopedGlobalShortcutById } from "@/hooks/useShortcut";
import { ClipboardCheck, Play, MessageSquare, Send, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { KbdShortcut } from "@/components/KbdShortcut";

interface PlanApprovalBarProps {
  allowedPrompts?: Array<{ tool: string; prompt: string }>;
  approveLabel?: string;
  initialFeedback?: string;
  onApprove: () => void;
  onRequestChanges: (feedback: string) => void;
  onReject?: () => void;
  error?: string | null;
}

interface FeedbackEditorProps {
  feedback: string;
  onFeedbackChange: (feedback: string) => void;
  onSend: () => void;
  onCancel: () => void;
}

function FeedbackEditor({
  feedback,
  onFeedbackChange,
  onSend,
  onCancel,
}: FeedbackEditorProps): ReactElement {
  return (
    <div className="flex items-end gap-2">
      <Textarea
        value={feedback}
        onChange={(event) => onFeedbackChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && feedback.trim()) {
            event.preventDefault();
            onSend();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        placeholder="Describe the changes you'd like..."
        rows={2}
        autoFocus
        className="max-h-24 min-h-[42px] resize-none border-border/50 bg-muted/40 py-2 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-ring/40"
      />
      <Button
        variant="default"
        size="icon"
        onClick={onSend}
        disabled={!feedback.trim()}
        className="h-[42px] w-[42px] shrink-0"
      >
        <Send className="size-3.5" />
      </Button>
    </div>
  );
}

interface PlanActionsProps {
  approveLabel?: string;
  onApprove: () => void;
  onRequestChanges: () => void;
  onReject?: () => void;
}

function PlanActions({
  approveLabel,
  onApprove,
  onRequestChanges,
  onReject,
}: PlanActionsProps): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="default" size="sm" onClick={onApprove} className="gap-1.5">
        <Play className="size-3.5" />
        {approveLabel ?? "Approve & Execute"}
        <KbdShortcut keys={["cmd", "Y"]} scope="agent" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRequestChanges}
        className="gap-1.5 text-muted-foreground"
      >
        <MessageSquare className="size-3.5" />
        Request Changes
        <KbdShortcut keys={["cmd", "N"]} scope="agent" />
      </Button>
      {onReject && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onReject}
          className="gap-1.5 text-muted-foreground"
        >
          <X className="size-3.5" />
          Reject & Stop
          <KbdShortcut keys={["esc"]} scope="agent" />
        </Button>
      )}
    </div>
  );
}

function PlanReviewSummary({
  allowedPrompts,
  error,
}: Pick<PlanApprovalBarProps, "allowedPrompts" | "error">): ReactElement {
  return (
    <>
      {allowedPrompts && allowedPrompts.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/70">Permissions requested:</span>
          <ul className="list-inside list-disc space-y-0.5">
            {allowedPrompts.map((prompt, index) => (
              <li key={index}>{prompt.prompt}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}
    </>
  );
}

export function PlanApprovalBar({
  allowedPrompts,
  approveLabel,
  initialFeedback,
  onApprove,
  onRequestChanges,
  onReject,
  error,
}: PlanApprovalBarProps) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState(initialFeedback ?? "");

  const openFeedback = (): void => {
    setFeedback((current) => current || initialFeedback || "");
    setShowFeedback(true);
  };

  useScopedGlobalShortcutById(
    "plan-approve",
    (e) => {
      e.preventDefault();
      onApprove();
    },
    "agent",
    { enabled: !showFeedback },
  );

  useScopedGlobalShortcutById(
    "plan-feedback",
    (e) => {
      e.preventDefault();
      openFeedback();
    },
    "agent",
    { enabled: !showFeedback },
  );

  useScopedGlobalShortcutById(
    "plan-reject",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      onReject!();
    },
    "agent",
    { enabled: !!onReject },
  );

  const handleSendFeedback = () => {
    const trimmed = feedback.trim();
    if (!trimmed) return;
    onRequestChanges(trimmed);
    setFeedback("");
    setShowFeedback(false);
  };

  return (
    <div className="agent-prompt-gate-panel flex flex-col gap-2 bg-card px-3 py-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <ClipboardCheck className="size-4 text-primary" />
        Plan ready for review
      </div>

      <PlanReviewSummary allowedPrompts={allowedPrompts} error={error} />

      {showFeedback ? (
        <FeedbackEditor
          feedback={feedback}
          onFeedbackChange={setFeedback}
          onSend={handleSendFeedback}
          onCancel={() => {
            if (onReject) {
              onReject();
            } else {
              setShowFeedback(false);
              setFeedback(initialFeedback ?? "");
            }
          }}
        />
      ) : (
        <PlanActions
          approveLabel={approveLabel}
          onApprove={onApprove}
          onRequestChanges={openFeedback}
          onReject={onReject}
        />
      )}
    </div>
  );
}
