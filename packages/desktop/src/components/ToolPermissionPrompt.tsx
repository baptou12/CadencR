import { useState, useCallback, useRef, useEffect } from "react";
import { useScopedHotkeys } from "@/hooks/useScopedHotkeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { KbdShortcut } from "@/components/KbdShortcut";
import { ShieldAlertIcon, SendIcon } from "lucide-react";
import { getPermissionPreview } from "./permission-preview";

export type PermissionDecisionValue = "allow_once" | "allow_future" | "deny";

export interface PermissionOption {
  decision: PermissionDecisionValue;
  optionId?: string;
  label: string;
  description: string;
  collectFeedback?: boolean;
}

export interface PendingPermission {
  toolName: string;
  input: Record<string, unknown>;
  description: string;
  pattern: string;
  preview?: string;
  options?: PermissionOption[];
  requestId?: string;
}

interface ToolPermissionPromptProps {
  /** The pending permission request to display */
  permission: PendingPermission;
  /** Called when the user makes a decision */
  onDecision: (decision: PermissionDecisionValue, feedback?: string, optionId?: string) => void;
  /** When true, disables keyboard shortcuts */
  disableShortcuts?: boolean;
}

const FALLBACK_OPTIONS: PermissionOption[] = [
  {
    decision: "allow_once",
    label: "Allow once",
    description: "Approve this tool call only",
    collectFeedback: false,
  },
  {
    decision: "deny",
    label: "Deny",
    description: "Reject this tool call",
    collectFeedback: true,
  },
];

interface PermissionOptionButtonProps {
  option: PermissionOption;
  index: number;
  highlighted: boolean;
  onClick: (index: number) => void;
  options: PermissionOption[];
}

const ALLOW_ONCE_SHORTCUT = ["cmd", "Y"];
const ALLOW_FUTURE_SHORTCUT = ["cmd", "L"];
const DENY_SHORTCUT = ["cmd", "N"];

function optionLabel(option: PermissionOption): string {
  return option.label.trim().toLowerCase();
}

function isAlwaysApprovalOption(option: PermissionOption): boolean {
  return optionLabel(option).includes("always");
}

function shouldShortcutAllowFuture(option: PermissionOption, options: PermissionOption[]): boolean {
  if (option.decision !== "allow_future") return false;
  const hasAlwaysApproval = options.some(
    (candidate) => candidate.decision === "allow_future" && isAlwaysApprovalOption(candidate),
  );
  return hasAlwaysApproval ? isAlwaysApprovalOption(option) : true;
}

function shouldShortcutDeny(option: PermissionOption): boolean {
  if (option.decision !== "deny") return false;
  const label = optionLabel(option);
  return label === "deny" || label.includes("deny and continue");
}

function shortcutKeysForOption(
  option: PermissionOption,
  options: PermissionOption[],
): string[] | undefined {
  if (option.decision === "allow_once") return ALLOW_ONCE_SHORTCUT;
  if (shouldShortcutAllowFuture(option, options)) return ALLOW_FUTURE_SHORTCUT;
  if (shouldShortcutDeny(option)) return DENY_SHORTCUT;
  return undefined;
}

function PermissionOptionButton({
  option,
  index,
  highlighted,
  onClick,
  options,
}: PermissionOptionButtonProps) {
  const shortcutKeys = shortcutKeysForOption(option, options);
  return (
    <button
      type="button"
      className={cn(
        "w-full rounded-md border px-3 py-2 text-left transition-colors",
        "border-border bg-muted/40 hover:bg-muted/50",
        highlighted && "ring-2 ring-blue-400 bg-blue-50/10 transition-none",
      )}
      onClick={() => onClick(index)}
    >
      <span className="text-sm font-medium text-foreground">
        {shortcutKeys && <KbdShortcut keys={shortcutKeys} variant="square" />}
        {option.label}
      </span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>
    </button>
  );
}

interface DenyFeedbackInputProps {
  feedback: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

function DenyFeedbackInput({ feedback, onChange, onSubmit }: DenyFeedbackInputProps) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <Input
        value={feedback}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
        }}
        placeholder="Reason for denying (optional)..."
        className="h-8 border-border/50 bg-muted/40 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-ring/40"
        autoFocus
      />
      <Button size="sm" onClick={onSubmit} className="h-8">
        <SendIcon className="mr-1.5 size-3" />
        Deny
      </Button>
    </div>
  );
}

interface PermissionHotkeysArgs {
  disableShortcuts: boolean | undefined;
  options: PermissionOption[];
  onTrigger: (index: number) => void;
}

function usePermissionHotkeys({
  disableShortcuts,
  options,
  onTrigger,
}: PermissionHotkeysArgs): void {
  const allowOnceIndex = options.findIndex((o) => o.decision === "allow_once");
  const allowFutureIndex = options.findIndex((o) => shouldShortcutAllowFuture(o, options));
  const denyIndex = options.findIndex(shouldShortcutDeny);

  // cmd+Y → approve (allow_once)
  useScopedHotkeys(
    "meta+y",
    (e) => {
      if (allowOnceIndex < 0 || e.shiftKey) return;
      e.preventDefault();
      onTrigger(allowOnceIndex);
    },
    "agent",
    { enabled: !disableShortcuts, enableOnFormTags: true, enableOnContentEditable: true },
    [onTrigger, allowOnceIndex],
  );

  // cmd+L → approve future requests when the provider exposes that option
  useScopedHotkeys(
    "meta+l",
    (e) => {
      if (allowFutureIndex < 0) return;
      e.preventDefault();
      onTrigger(allowFutureIndex);
    },
    "agent",
    { enabled: !disableShortcuts, enableOnFormTags: true, enableOnContentEditable: true },
    [onTrigger, allowFutureIndex],
  );

  // cmd+N → reject (deny)
  useScopedHotkeys(
    "meta+n",
    (e) => {
      if (denyIndex < 0) return;
      e.preventDefault();
      onTrigger(denyIndex);
    },
    "agent",
    { enabled: !disableShortcuts, enableOnFormTags: true, enableOnContentEditable: true },
    [onTrigger, denyIndex],
  );
}

/**
 * Inline permission prompt shown when an agent tool call requires user approval.
 * Displays the tool name, description, request preview, and runtime-provided options.
 */
export function ToolPermissionPrompt({
  permission,
  onDecision,
  disableShortcuts,
}: ToolPermissionPromptProps) {
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const options =
    permission.options && permission.options.length > 0 ? permission.options : FALLBACK_OPTIONS;
  const rawCommand = getPermissionPreview(permission);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      if (actionTimerRef.current) clearTimeout(actionTimerRef.current);
    };
  }, []);

  const flashHighlight = useCallback((index: number) => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightedIndex(index);
    highlightTimerRef.current = setTimeout(() => setHighlightedIndex(null), 300);
  }, []);

  const submitOption = useCallback(
    (option: PermissionOption) => {
      const trimmedFeedback = feedback.trim() || undefined;
      if (option.decision === "deny") {
        if (option.optionId) onDecision("deny", trimmedFeedback, option.optionId);
        else onDecision("deny", trimmedFeedback);
        return;
      }
      if (option.optionId) onDecision(option.decision, undefined, option.optionId);
      else onDecision(option.decision);
    },
    [feedback, onDecision],
  );

  const handleOption = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option) return;
      if (option.decision === "deny" && option.collectFeedback && !showFeedback) {
        setShowFeedback(true);
        return;
      }
      submitOption(option);
    },
    [options, showFeedback, submitOption],
  );

  const handleDenyWithEnter = useCallback(() => {
    const denyOption = options.find((option) => option.decision === "deny");
    if (denyOption) submitOption(denyOption);
  }, [options, submitOption]);

  const handleHotkey = useCallback(
    (index: number) => {
      if (actionTimerRef.current) clearTimeout(actionTimerRef.current);
      flashHighlight(index);
      actionTimerRef.current = setTimeout(() => handleOption(index), 150);
    },
    [flashHighlight, handleOption],
  );

  usePermissionHotkeys({ disableShortcuts, options, onTrigger: handleHotkey });

  return (
    <div className="border-t border-amber-500/30 bg-card px-3 py-2">
      {/* Header */}
      <div className="mb-2 flex items-center gap-2 text-xs text-amber-400">
        <ShieldAlertIcon className="size-3.5" />
        <span className="font-medium">Permission Required</span>
        <span className="text-muted-foreground">-</span>
        <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-foreground">
          {permission.toolName}
        </code>
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
        {options.map((option, index) => (
          <PermissionOptionButton
            key={`${option.decision}-${option.label}`}
            option={option}
            index={index}
            highlighted={highlightedIndex === index}
            onClick={handleOption}
            options={options}
          />
        ))}
      </div>

      {/* Feedback input for deny */}
      {showFeedback && (
        <DenyFeedbackInput
          feedback={feedback}
          onChange={setFeedback}
          onSubmit={handleDenyWithEnter}
        />
      )}
    </div>
  );
}
