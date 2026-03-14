import { useEffect, useRef, useState } from "react";
import {
  ChevronRightIcon,
  CheckCircle2Icon,
  Loader2Icon,
  AlertCircleIcon,
  GitBranchIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useRetryWorktreeSetup, useGetFeatureSettings } from "@/api/generated";
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
      className="mt-1 max-h-40 overflow-auto rounded bg-muted/50 px-2 py-1.5 text-xs font-mono text-muted-foreground whitespace-pre-wrap"
    >
      {log}
    </pre>
  );
}

export function WorktreeSetupSection({
  featureId,
  projectId,
}: {
  featureId: number;
  projectId: number;
}) {
  const { data: settingsArray } = useGetFeatureSettings(featureId);
  const settings = settingsArray
    ? Object.fromEntries(settingsArray.map((s) => [s.key, s.value]))
    : undefined;

  const retryMutation = useRetryWorktreeSetup();

  const step = (settings?.worktree_setup_step as SetupStep) ?? null;
  const log = settings?.worktree_setup_log ?? "";
  const error = settings?.worktree_setup_error ?? "";
  const branch = settings?.worktree_branch ?? "";

  const isDone = step === "done";
  const isError = step === "error";
  const isRunning = !!step && !isDone && !isError;

  // Collapse by default when done; expand while running or on error
  const [userToggle, setUserToggle] = useState<boolean | null>(null);
  const isOpen = userToggle ?? (isRunning || isError);

  // Don't render if setup hasn't started
  if (!step) return null;

  const currentStep = stepIndex(step);

  // Steps UI data
  const steps = [
    {
      label: "Define name",
      complete: currentStep >= 1, // >= "named"
      active: step === "naming",
      error: false,
    },
    {
      label: "Create worktree",
      complete: currentStep >= 3, // >= "created"
      active: step === "creating",
      error: isError && (currentStep < 3),
      detail: branch ? branch : undefined,
    },
    {
      label: "Run setup commands",
      complete: isDone && currentStep >= 5,
      active: step === "setup",
      error: isError && currentStep >= 3,
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
            <div className="flex items-center gap-2 pt-1">
              {error && (
                <span className="text-xs text-red-400 truncate flex-1">
                  {error}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5"
                disabled={retryMutation.isLoading}
                onClick={() =>
                  retryMutation.mutate({ projectId, featureId })
                }
              >
                <RefreshCwIcon
                  className={cn(
                    "size-3",
                    retryMutation.isLoading && "animate-spin",
                  )}
                />
                Retry
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
