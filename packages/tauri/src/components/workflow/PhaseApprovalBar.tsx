import { useState, useCallback } from "react";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";
import { ShieldCheck, MessageSquare, Send, X, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { KbdShortcut } from "@/components/KbdShortcut";
import { Markdown } from "@/components/Markdown";

interface PhaseApprovalBarProps {
  phaseName: string;
  artifactContent: string;
  onApprove: () => void;
  onReject: (feedback: string) => void;
}

export function PhaseApprovalBar({
  phaseName,
  artifactContent,
  onApprove,
  onReject,
}: PhaseApprovalBarProps) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  useGlobalShortcut("meta+1", (e) => {
    e.preventDefault();
    onApprove();
  }, { enabled: !showFeedback });

  useGlobalShortcut("meta+2", (e) => {
    e.preventDefault();
    setShowFeedback(true);
  }, { enabled: !showFeedback });

  useGlobalShortcut("escape", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (showFeedback) {
      setShowFeedback(false);
      setFeedback("");
    } else if (showPreview) {
      setShowPreview(false);
    } else {
      onReject("");
    }
  });

  const handleSendFeedback = useCallback(() => {
    const trimmed = feedback.trim();
    if (!trimmed) return;
    onReject(trimmed);
    setFeedback("");
    setShowFeedback(false);
  }, [feedback, onReject]);

  return (
    <div className="flex flex-col gap-2 bg-[#181A25] px-3 py-3">
      {/* Artifact preview */}
      {showPreview && artifactContent && (
        <div className="max-h-64 overflow-y-auto rounded-md border border-gray-800 bg-muted/30 px-3 py-2 text-sm">
          <Markdown content={artifactContent} />
        </div>
      )}

      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <ShieldCheck className="size-4 text-orange-400" />
        Phase &apos;{phaseName}&apos; is awaiting your approval
      </div>

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
            placeholder="Describe what should be changed..."
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
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={onApprove}
            className="gap-1.5 bg-green-600 hover:bg-green-700"
          >
            <ShieldCheck className="size-3.5" />
            Approve
            <KbdShortcut keys={["cmd", "1"]} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFeedback(true)}
            className="gap-1.5 text-yellow-400 hover:text-yellow-300"
          >
            <MessageSquare className="size-3.5" />
            Request Changes
            <KbdShortcut keys={["cmd", "2"]} />
          </Button>
          {artifactContent && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowPreview(!showPreview)}
              className="gap-1.5 text-muted-foreground"
            >
              {showPreview ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              {showPreview ? "Hide Artifact" : "View Artifact"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onReject("")}
            className="gap-1.5 text-red-400 hover:text-red-300"
          >
            <X className="size-3.5" />
            Reject
            <KbdShortcut keys={["esc"]} />
          </Button>
        </div>
      )}
    </div>
  );
}
