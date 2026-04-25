import { cn } from "@/lib/utils";
import type { CustomActionLastRunSummary } from "@/api/generated";

interface CustomActionStatusDotProps {
  lastRun: CustomActionLastRunSummary | null;
  isRunning: boolean;
  className?: string;
}

/**
 * Tiny dot rendered on top of an action's icon.
 * - gray: never run
 * - pulsing amber: currently running (manual trigger or schedule)
 * - green: last run exited 0
 * - red: last run exited non-zero
 */
export function CustomActionStatusDot({
  lastRun,
  isRunning,
  className,
}: CustomActionStatusDotProps) {
  // Server-side a run is "running" when ended_at is null. We embed the same
  // shape on `CustomAction.last_run`, so derive locally rather than asking
  // the backend for a separate flag.
  const stillRunning = isRunning || (lastRun != null && lastRun.ended_at == null);

  let color = "bg-muted-foreground/40";
  let label = "Never run";
  if (stillRunning) {
    color = "bg-amber-500 animate-pulse";
    label = "Running…";
  } else if (lastRun && lastRun.exit_code != null) {
    if (lastRun.exit_code === 0) {
      color = "bg-emerald-500";
      label = "Last run succeeded";
    } else {
      color = "bg-red-500";
      label = `Last run failed (exit ${lastRun.exit_code})`;
    }
  }
  return (
    <span
      aria-label={label}
      title={label}
      className={cn(
        "absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-1 ring-background",
        color,
        className,
      )}
    />
  );
}
