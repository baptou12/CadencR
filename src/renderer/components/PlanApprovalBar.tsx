import { useState, useEffect } from "react";
import { ClipboardCheck, Play, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { KbdShortcut } from "@/components/KbdShortcut";

interface PlanApprovalBarProps {
  allowedPrompts?: Array<{ tool: string; prompt: string }>;
  approveLabel?: string;
  onApprove: () => void;
  onRequestChanges: (feedback: string) => void;
}

export function PlanApprovalBar({
  allowedPrompts,
  approveLabel,
  onApprove,
  onRequestChanges,
}: PlanApprovalBarProps) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    if (showFeedback) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;

      if (e.key === "1") {
        e.preventDefault();
        onApprove();
      } else if (e.key === "2") {
        e.preventDefault();
        setShowFeedback(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showFeedback, onApprove]);

  const handleSendFeedback = () => {
    const trimmed = feedback.trim();
    if (!trimmed) return;
    onRequestChanges(trimmed);
    setFeedback("");
    setShowFeedback(false);
  };

  return (
    <div className="flex flex-col gap-2 bg-muted/20 px-3 py-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <ClipboardCheck className="size-4 text-blue-400" />
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
                setShowFeedback(false);
                setFeedback("");
              }
            }}
            placeholder="Describe the changes you'd like..."
            rows={2}
            autoFocus
            className="max-h-24 min-h-[42px] resize-none border-border/50 bg-background py-2 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-ring/40"
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
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={onApprove}
            className="gap-1.5"
          >
            <Play className="size-3.5" />
            {approveLabel ?? "Approve & Execute"}
            <KbdShortcut keys={["cmd", "1"]} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFeedback(true)}
            className="gap-1.5 text-muted-foreground"
          >
            <MessageSquare className="size-3.5" />
            Request Changes
            <KbdShortcut keys={["cmd", "2"]} />
          </Button>
        </div>
      )}
    </div>
  );
}
