import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2Icon,
  Loader2Icon,
  AlertCircleIcon,
  AlertTriangleIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useGetFeatureSettings } from "@/api/generated";
import { settingsArrayToMap } from "@/api/settings";
import type { WorktreeStatus } from "@/types/workflow";
import { Button } from "@/components/ui/button";
import { BashBlock } from "@/components/BashBlock";
import { useFeatureWorktreeInfo } from "@/hooks/useFeatureWorktreePath";
import {
  WorktreeSetupHeader,
  type WorktreeSetupDisplayStatus,
} from "@/components/WorktreeSetupHeader";

type SetupStep = "naming" | "named" | "creating" | "created" | "setup" | "done" | "error";

const STEP_ORDER: SetupStep[] = ["naming", "named", "creating", "created", "setup", "done"];

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
}): ReactElement {
  if (error) return <AlertCircleIcon className="size-4 text-red-400" />;
  if (complete) return <CheckCircle2Icon className="size-4 text-green-500" />;
  if (active) return <Loader2Icon className="size-4 animate-spin text-blue-400" />;
  return <div className="size-4 rounded-full border border-muted-foreground/30" />;
}

function LogOutput({ log }: { log: string }): ReactElement {
  return (
    <BashBlock
      command="Setup — worktree commands"
      content={log}
      bodyExtraClassName="max-h-40 overflow-y-auto"
    />
  );
}

/** Map WorktreeStatus from WS store to tRPC-style SetupStep */
function wsStatusToStep(status: WorktreeStatus): SetupStep | null {
  switch (status) {
    case "idle":
      return null;
    case "creating":
      return "creating";
    case "created":
      return "created";
    case "setup_running":
      return "setup";
    case "ready":
      return "done";
    case "setup_error":
      return "error";
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

interface WorktreeSetupSectionProps {
  featureId: number;
  projectId: number;
  /** WS-driven worktree state (optional — when set, overrides tRPC polling) */
  wsWorktreeStatus?: WorktreeStatus;
  wsWorktreeBranch?: string | null;
  wsWorktreeSetupOutput?: string[];
  wsWorktreeError?: string | null;
  /** Retry handler invoked from the error state UI. ws-session callers always
   *  supply this; if omitted the retry button silently no-ops. */
  onRetrySetup?: () => void;
}

interface SetupStepItem {
  label: string;
  complete: boolean;
  active: boolean;
  error: boolean;
  detail?: string;
  showLog?: boolean;
}

interface WorktreeSetupDetailsProps {
  branch: string;
  branchExists: boolean | null;
  healthError: unknown;
  isMissing: boolean;
  steps: SetupStepItem[];
  log: string;
  isError: boolean;
  setupError: string;
  onRetrySetup?: () => void;
}

function useWorktreeSetupDisclosure(
  featureId: number,
  useWsMode: boolean,
  step: SetupStep | null,
): [boolean, () => void] {
  const [userToggle, setUserToggle] = useState<boolean | null>(null);
  const previousStepRef = useRef<SetupStep | null>(null);
  const didObserveStepRef = useRef(false);

  useEffect((): void => {
    setUserToggle(null);
    previousStepRef.current = null;
    didObserveStepRef.current = false;
  }, [featureId, useWsMode]);

  useEffect((): void => {
    if (!step) return;
    const previousStep = previousStepRef.current;
    previousStepRef.current = step;
    if (!didObserveStepRef.current) {
      didObserveStepRef.current = true;
      return;
    }
    if (previousStep !== step && step === "error") setUserToggle(true);
  }, [step]);

  const isOpen = userToggle ?? false;
  return [isOpen, () => setUserToggle((prev) => !(prev ?? isOpen))];
}

function buildSetupSteps(step: SetupStep, branch: string): SetupStepItem[] {
  const currentStep = stepIndex(step);
  const worktreeCreated = !!branch;
  return [
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
      error: false,
      detail: branch ? branch : undefined,
    },
    {
      label: "Run setup commands",
      complete: step === "done",
      active: step === "setup",
      error: step === "error",
      showLog: true,
    },
  ];
}

export function WorktreeSetupSection({
  featureId,
  projectId,
  wsWorktreeStatus,
  wsWorktreeBranch,
  wsWorktreeSetupOutput,
  wsWorktreeError,
  onRetrySetup,
}: WorktreeSetupSectionProps): ReactElement | null {
  const useWsMode = wsWorktreeStatus != null && wsWorktreeStatus !== "idle";
  const hasWsSetupOutput = (wsWorktreeSetupOutput?.length ?? 0) > 0;
  const shouldLoadSettings = !useWsMode || !hasWsSetupOutput;
  const { data: settingsArray } = useGetFeatureSettings(featureId, {
    query: { enabled: shouldLoadSettings },
  });
  const settings = useMemo(() => settingsArrayToMap(settingsArray), [settingsArray]);

  const step = useWsMode
    ? wsStatusToStep(wsWorktreeStatus!)
    : dbStepToSetupStep(settings?.worktree_setup_step);
  const branch = useWsMode ? (wsWorktreeBranch ?? "") : (settings?.worktree_branch ?? "");
  const setupError = useWsMode ? (wsWorktreeError ?? "") : (settings?.worktree_setup_error ?? "");

  const isDone = step === "done";
  const isError = step === "error";
  const isRunning = !!step && !isDone && !isError;
  const health = useFeatureWorktreeInfo(featureId, projectId, isDone);
  const isMissing = Boolean(
    isDone && health.worktree && !health.worktree.is_main_worktree && !health.worktree.live,
  );
  const branchExists = health.worktree?.branch_exists ?? null;
  const displayStatus: WorktreeSetupDisplayStatus = isMissing
    ? "removed"
    : health.error != null
      ? "health-error"
      : health.isLoading && isDone
        ? "checking"
        : isDone
          ? "ready"
          : isRunning
            ? "running"
            : "setup-error";
  const [isOpen, toggleOpen] = useWorktreeSetupDisclosure(featureId, useWsMode, step);
  const wsSetupLog = useMemo(
    () => (isOpen && hasWsSetupOutput ? (wsWorktreeSetupOutput ?? []).join("\n") : ""),
    [hasWsSetupOutput, isOpen, wsWorktreeSetupOutput],
  );
  const log = useWsMode
    ? wsSetupLog || (settings?.worktree_setup_log ?? "")
    : (settings?.worktree_setup_log ?? "");

  if (!step) return null;

  const steps = buildSetupSteps(step, branch);

  return (
    <div className="flex flex-col bg-background" data-worktree-setup>
      <WorktreeSetupHeader
        branch={branch}
        branchExists={branchExists}
        status={displayStatus}
        isOpen={isOpen}
        onToggle={toggleOpen}
      />
      {isOpen && (
        <WorktreeSetupDetails
          steps={steps}
          branch={branch}
          branchExists={branchExists}
          healthError={health.error}
          isMissing={isMissing}
          log={log}
          isError={isError}
          setupError={setupError}
          onRetrySetup={onRetrySetup}
        />
      )}
    </div>
  );
}

function WorktreeSetupDetails({
  branch,
  branchExists,
  healthError,
  isMissing,
  steps,
  log,
  isError,
  setupError,
  onRetrySetup,
}: WorktreeSetupDetailsProps): ReactElement {
  return (
    <div className="space-y-1.5 border-t border-border/50 px-3 py-2 md:px-6">
      {isMissing && <MissingWorktreeWarning branch={branch} branchExists={branchExists} />}
      {healthError != null && (
        <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>Could not verify whether the worktree and branch still exist.</span>
        </div>
      )}
      {steps.map((step, index) => (
        <WorktreeSetupStep key={step.label} index={index} log={log} step={step} />
      ))}
      {isError && <WorktreeSetupRetry setupError={setupError} onRetrySetup={onRetrySetup} />}
    </div>
  );
}

function MissingWorktreeWarning({
  branch,
  branchExists,
}: {
  branch: string;
  branchExists: boolean | null;
}): ReactElement {
  const branchStatus =
    branchExists === true
      ? `The branch ${branch || "recorded for this session"} still exists.`
      : branchExists === false
        ? `The branch ${branch || "recorded for this session"} was also removed.`
        : "The branch status could not be determined.";
  return (
    <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
      <span>
        This worktree was removed from the machine. {branchStatus} Cadencr is using the project
        folder instead.
      </span>
    </div>
  );
}

function WorktreeSetupStep({
  index,
  log,
  step,
}: {
  index: number;
  log: string;
  step: SetupStepItem;
}): ReactElement {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5">
        <StepIcon complete={step.complete} active={step.active} error={step.error} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">{index + 1}.</span>
          <span className="text-xs">{step.label}</span>
          {step.detail && (
            <span className="text-[10px] text-muted-foreground font-mono truncate">
              {step.detail}
            </span>
          )}
        </div>
        {step.showLog && log && (step.active || step.complete || step.error) && (
          <LogOutput log={log} />
        )}
      </div>
    </div>
  );
}

function WorktreeSetupRetry({
  setupError,
  onRetrySetup,
}: {
  setupError: string;
  onRetrySetup?: () => void;
}): ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-2 pt-0.5">
      <Button
        variant="outline"
        size="sm"
        type="button"
        className="h-6 gap-1.5 text-xs"
        onClick={onRetrySetup}
      >
        <RefreshCwIcon className="size-3" />
        Retry
      </Button>
      {setupError && (
        <p className="min-w-0 truncate text-xs text-red-400" title={setupError}>
          {setupError}
        </p>
      )}
    </div>
  );
}
