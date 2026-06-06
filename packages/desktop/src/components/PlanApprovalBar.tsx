import { useState } from "react";
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
    <div className="flex flex-col gap-2 bg-card px-3 py-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <ClipboardCheck className="size-4 text-primary" />
        Plan ready for review
      </div>

      {allowedPrompts && allowedPrompts.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/70">Permissions requested:</span>
          <ul className="list-inside list-disc space-y-0.5">
            {allowedPrompts.map((p, i) => (
              <li key={i}>{p.prompt}</li>
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

      {showFeedback ? (
        <div className="flex items-end gap-2">
          <Textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && feedback.trim()) {
                e.preventDefault();
                handleSendFeedback();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                if (onReject) {
                  onReject();
                } else {
                  setShowFeedback(false);
                  setFeedback(initialFeedback ?? "");
                }
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
            onClick={handleSendFeedback}
            disabled={!feedback.trim()}
            className="h-[42px] w-[42px] shrink-0"
          >
            <Send className="size-3.5" />
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="default" size="sm" onClick={onApprove} className="gap-1.5">
            <Play className="size-3.5" />
            {approveLabel ?? "Approve & Execute"}
            <KbdShortcut keys={["cmd", "Y"]} scope="agent" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={openFeedback}
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
      )}
    </div>
  );
}
