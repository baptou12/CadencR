import { useState, useCallback, useRef, useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ShieldAlertIcon, SendIcon } from "lucide-react";

export interface PendingPermission {
  toolName: string;
  input: Record<string, unknown>;
  description: string;
  pattern: string;
}

interface ToolPermissionPromptProps {
  /** The pending permission request to display */
  permission: PendingPermission;
  /** Called when the user makes a decision */
  onDecision: (decision: "allow_once" | "allow_future" | "deny", feedback?: string) => void;
  /** When true, disables keyboard shortcuts */
  disableShortcuts?: boolean;
}

/**
 * Inline permission prompt shown when an agent tool call requires user approval.
 * Displays the tool name, description, raw command, and three options with CMD+number shortcuts.
 */
export function ToolPermissionPrompt({ permission, onDecision, disableShortcuts }: ToolPermissionPromptProps) {
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Extract the raw command/path for display
  const rawCommand = typeof permission.input.command === "string"
    ? permission.input.command
    : typeof permission.input.file_path === "string"
      ? permission.input.file_path
      : typeof permission.input.path === "string"
        ? permission.input.path
        : null;

  // Clean up highlight timer on unmount
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const flashHighlight = useCallback((index: number) => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightedIndex(index);
    highlightTimerRef.current = setTimeout(() => setHighlightedIndex(null), 300);
  }, []);

  const handleAllowOnce = useCallback(() => {
    onDecision("allow_once");
  }, [onDecision]);

  const handleAllowFuture = useCallback(() => {
    onDecision("allow_future");
  }, [onDecision]);

  const handleDeny = useCallback(() => {
    if (showFeedback) {
      onDecision("deny", feedback.trim() || undefined);
    } else {
      setShowFeedback(true);
    }
  }, [onDecision, showFeedback, feedback]);

  const handleDenyWithEnter = useCallback(() => {
    onDecision("deny", feedback.trim() || undefined);
  }, [onDecision, feedback]);

  // CMD+1: Allow once
  useHotkeys(
    "meta+1",
    (e) => {
      e.preventDefault();
      flashHighlight(0);
      // Small delay so the highlight is visible before action
      setTimeout(handleAllowOnce, 150);
    },
    { enabled: !disableShortcuts, enableOnFormTags: true },
    [handleAllowOnce, flashHighlight],
  );

  // CMD+2: Allow for future
  useHotkeys(
    "meta+2",
    (e) => {
      e.preventDefault();
      flashHighlight(1);
      setTimeout(handleAllowFuture, 150);
    },
    { enabled: !disableShortcuts, enableOnFormTags: true },
    [handleAllowFuture, flashHighlight],
  );

  // CMD+3: Deny
  useHotkeys(
    "meta+3",
    (e) => {
      e.preventDefault();
      flashHighlight(2);
      if (!showFeedback) {
        setTimeout(() => setShowFeedback(true), 150);
      } else {
        setTimeout(handleDenyWithEnter, 150);
      }
    },
    { enabled: !disableShortcuts, enableOnFormTags: true },
    [showFeedback, handleDenyWithEnter, flashHighlight],
  );

  return (
    <div className="border-t border-amber-500/30 bg-[#181A25] px-3 py-2">
      {/* Header */}
      <div className="mb-2 flex items-center gap-2 text-xs text-amber-400">
        <ShieldAlertIcon className="size-3.5" />
        <span className="font-medium">Permission Required</span>
        <span className="text-muted-foreground">-</span>
        <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">{permission.toolName}</code>
      </div>

      {/* Description */}
      <p className="mb-1.5 text-sm text-foreground">{permission.description}</p>

      {/* Raw command / path */}
      {rawCommand && (
        <pre className="mb-3 max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-xs text-foreground font-mono whitespace-pre-wrap break-all">
          {rawCommand}
        </pre>
      )}

      {/* Options */}
      <div className="mb-2 flex flex-col gap-1.5">
        {/* Allow once */}
        <button
          type="button"
          className={cn(
            "w-full rounded-md border px-3 py-2 text-left transition-colors",
            "border-border bg-muted/40 hover:bg-muted/50",
            highlightedIndex === 0 && "ring-2 ring-blue-400 bg-blue-50/10 transition-none",
          )}
          onClick={handleAllowOnce}
        >
          <span className="text-sm font-medium text-foreground">
            <kbd className="mr-1.5 inline-flex size-5 items-center justify-center rounded border border-border bg-muted text-[10px] text-foreground">1</kbd>
            Allow once
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">Approve this tool call only</span>
        </button>

        {/* Allow for future */}
        <button
          type="button"
          className={cn(
            "w-full rounded-md border px-3 py-2 text-left transition-colors",
            "border-border bg-muted/40 hover:bg-muted/50",
            highlightedIndex === 1 && "ring-2 ring-blue-400 bg-blue-50/10 transition-none",
          )}
          onClick={handleAllowFuture}
        >
          <span className="text-sm font-medium text-foreground">
            <kbd className="mr-1.5 inline-flex size-5 items-center justify-center rounded border border-border bg-muted text-[10px] text-foreground">2</kbd>
            Allow for future use
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Save <code className="rounded bg-muted px-1 text-[10px]">{permission.pattern}</code> to settings
          </span>
        </button>

        {/* Deny */}
        <button
          type="button"
          className={cn(
            "w-full rounded-md border px-3 py-2 text-left transition-colors",
            "border-border bg-muted/40 hover:bg-muted/50",
            highlightedIndex === 2 && "ring-2 ring-blue-400 bg-blue-50/10 transition-none",
          )}
          onClick={handleDeny}
        >
          <span className="text-sm font-medium text-foreground">
            <kbd className="mr-1.5 inline-flex size-5 items-center justify-center rounded border border-border bg-muted text-[10px] text-foreground">3</kbd>
            Deny
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">Reject this tool call (with optional feedback)</span>
        </button>
      </div>

      {/* Feedback input for deny */}
      {showFeedback && (
        <div className="mt-2 flex items-center gap-2">
          <Input
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleDenyWithEnter();
            }}
            placeholder="Reason for denying (optional)..."
            className="h-8 border-border/50 bg-muted/40 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-ring/40"
            autoFocus
          />
          <Button size="sm" onClick={handleDenyWithEnter} className="h-8">
            <SendIcon className="mr-1.5 size-3" />
            Deny
          </Button>
        </div>
      )}
    </div>
  );
}
