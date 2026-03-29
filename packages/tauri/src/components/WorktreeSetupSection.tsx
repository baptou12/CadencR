import { useEffect, useRef, useState } from "react";
import {
  ChevronRightIcon,
  CheckCircle2Icon,
  Loader2Icon,
  AlertCircleIcon,
  GitBranchIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useGetFeatureSettings } from "@/api/generated";
import type { WorktreeStatus } from "@/types/workflow";
import { useWorkflowStore } from "@/hooks/useWorkflowWebSocket";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SetupStep =
  | "naming"
  | "named"
  | "creating"
  | "created"
  | "setup"
  | "done"
  | "error";

const STEP_ORDER: SetupStep[] = [
  "naming",
  "named",
  "creating",
  "created",
  "setup",
  "done",
];

function stepIndex(step: SetupStep): number {
  const idx = STEP_ORDER.indexOf(step);
  return idx >= 0 ? idx : -1;
}

function StepIcon({
  complete,
  active,
  error,
}: {
  complete: boolean;
  active: boolean;
  error: boolean;
}) {
  if (error) return <AlertCircleIcon className="size-4 text-red-400" />;
  if (complete) return <CheckCircle2Icon className="size-4 text-green-500" />;
  if (active)
    return <Loader2Icon className="size-4 animate-spin text-blue-400" />;
  return <div className="size-4 rounded-full border border-muted-foreground/30" />;
}

function LogOutput({ log }: { log: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [log]);
  return (
    <pre
      ref={ref}
      className="mt-1 max-h-40 overflow-auto rounded bg-zinc-900 px-2 py-1.5 text-xs font-mono text-zinc-100 whitespace-pre-wrap"
    >
      {log}
    </pre>
  );
}

/** Map WorktreeStatus from WS store to tRPC-style SetupStep */
function wsStatusToStep(status: WorktreeStatus): SetupStep | null {
  switch (status) {
    case "idle": return null;
    case "creating": return "creating";
    case "created": return "created";
    case "setup_running": return "setup";
    case "ready": return "done";
    case "setup_error": return "error";
  }
}

/** Map raw DB worktree_setup_step values to SetupStep (DB stores "ready", UI expects "done") */
function dbStepToSetupStep(raw: string | undefined): SetupStep | null {
  if (!raw) return null;
  if (raw === "ready") return "done";
  if (raw === "setup_running") return "setup";
  if (raw === "setup_error") return "error";
  return raw as SetupStep;
}

export function WorktreeSetupSection({
  featureId,
  projectId,
  wsWorktreeStatus,
  wsWorktreeBranch,
  wsWorktreeSetupOutput,
}: {
  featureId: number;
  projectId: number;
  /** WS-driven worktree state (optional — when set, overrides tRPC polling) */
  wsWorktreeStatus?: WorktreeStatus;
  wsWorktreeBranch?: string | null;
  wsWorktreeSetupOutput?: string[];
}) {
  const useWsMode = wsWorktreeStatus != null && wsWorktreeStatus !== "idle";

  const { data: settingsArray } = useGetFeatureSettings(featureId, { enabled: !useWsMode });
  const settings = !useWsMode && settingsArray
    ? Object.fromEntries(settingsArray.map((s) => [s.key, s.value]))
    : undefined;

  const retryWorktreeSetup = useWorkflowStore((s) => s.retryWorktreeSetup);

  const step = useWsMode
    ? wsStatusToStep(wsWorktreeStatus!)
    : dbStepToSetupStep(settings?.worktree_setup_step);
  const log = useWsMode
    ? (wsWorktreeSetupOutput ?? []).join("\n")
    : (settings?.worktree_setup_log ?? "");
  const branch = useWsMode
    ? (wsWorktreeBranch ?? "")
    : (settings?.worktree_branch ?? "");

  const isDone = step === "done";
  const isError = step === "error";
  const isRunning = !!step && !isDone && !isError;

  // Collapse by default when done; expand while running or on error
  const [userToggle, setUserToggle] = useState<boolean | null>(null);
  const isOpen = userToggle ?? (isRunning || isError);

  // Don't render if setup hasn't started
  if (!step) return null;

  const currentStep = stepIndex(step);

  // Worktree exists if we have a branch (naming + creation succeeded)
  const worktreeCreated = !!branch;

  // Steps UI data
  const steps = [
    {
      label: "Define name",
      complete: worktreeCreated || currentStep >= 1,
      active: step === "naming",
      error: false,
    },
    {
      label: "Create worktree",
      complete: worktreeCreated || currentStep >= 3,
      active: step === "creating",
      error: false, // worktree creation errors are fatal, not retryable here
      detail: branch ? branch : undefined,
    },
    {
      label: "Run setup commands",
      complete: isDone,
      active: step === "setup",
      error: isError,
      showLog: true,
    },
  ];

  return (
    <div className="mb-2 flex flex-col rounded-lg border border-border bg-background">
      {/* Header */}
      <div
        className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-muted/50"
        onClick={() => setUserToggle((prev) => !(prev ?? isOpen))}
      >
        <ChevronRightIcon
          className={cn(
            "size-4 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-90",
          )}
        />
        <GitBranchIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Worktree Setup</span>
        <Badge
          variant="secondary"
          className={cn(
            "gap-1 text-xs",
            isDone && "bg-green-500/15 text-green-400",
            isRunning && "bg-blue-500/15 text-blue-400",
            isError && "bg-red-500/15 text-red-400",
          )}
        >
          {isDone && (
            <>
              <CheckCircle2Icon className="size-3" />
              done
            </>
          )}
          {isRunning && (
            <>
              <Loader2Icon className="size-3 animate-spin" />
              running
            </>
          )}
          {isError && (
            <>
              <AlertCircleIcon className="size-3" />
              error
            </>
          )}
        </Badge>
      </div>

      {/* Body */}
      {isOpen && (
        <div className="space-y-2 border-t border-border px-4 py-3">
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="mt-0.5">
                <StepIcon
                  complete={s.complete}
                  active={s.active}
                  error={s.error}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {i + 1}.
                  </span>
                  <span className="text-sm">{s.label}</span>
                  {s.detail && (
                    <span className="text-xs text-muted-foreground font-mono truncate">
                      {s.detail}
                    </span>
                  )}
                </div>
                {s.showLog && log && (s.active || s.complete || s.error) && (
                  <LogOutput log={log} />
                )}
              </div>
            </div>
          ))}

          {isError && (
            <div className="pt-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5"
                onClick={retryWorktreeSetup}
              >
                <RefreshCwIcon className="size-3" />
                Retry
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
