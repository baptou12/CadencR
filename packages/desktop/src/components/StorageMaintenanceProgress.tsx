import { ProgressBar } from "@/components/ui/progress-bar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  useStorageMaintenanceStore,
  type StorageMaintenanceStatus,
} from "@/stores/storage-maintenance-store";

function statusLabel(status: StorageMaintenanceStatus): string {
  if (status.task === "unknown") return "Storage status unavailable";
  if (status.task === "cleanup") {
    if (status.phase === "completed") return "Conversation cleanup complete";
    if (status.phase === "cancelled") return "Conversation cleanup paused";
    if (status.phase === "failed") return "Conversation cleanup will retry";
    return "Cleaning archived conversations";
  }
  if (status.phase === "completed") return "Storage optimization complete";
  if (status.phase === "cancelled") return "Storage optimization paused";
  if (status.phase === "failed") return "Storage optimization will retry";
  return "Optimizing storage";
}

function progressDescription(status: StorageMaintenanceStatus): string {
  const percentage = status.total > 0 ? Math.round((status.completed / status.total) * 100) : 0;
  if (status.task !== "cleanup") return `Progress: ${percentage}%.`;

  const conversations = status.total === 1 ? "conversation" : "conversations";
  switch (status.phase) {
    case "completed":
      return `Completed ${status.completed} of ${status.total} archived ${conversations}.`;
    case "cancelled":
      return `Paused safely after ${status.completed} of ${status.total} archived ${conversations}.`;
    case "failed":
      return `Stopped safely after ${status.completed} of ${status.total} archived ${conversations}. It will retry automatically, or you can run it from Settings.`;
    default:
      return `Processed ${status.completed} of ${status.total} archived ${conversations}.`;
  }
}

function MaintenanceExplanation({
  status,
}: {
  status: StorageMaintenanceStatus;
}): React.JSX.Element {
  if (status.task === "cleanup") {
    return (
      <>
        <p className="font-semibold text-popover-foreground">Archived conversation cleanup</p>
        <p>{progressDescription(status)}</p>
        <p>
          <strong className="font-semibold text-popover-foreground">
            You can keep using Cadencr normally while cleanup runs.
          </strong>
        </p>
        <p>
          Only old archived conversations are processed. Cadencr shortens long command output to
          save space.
        </p>
        <p>
          <strong className="font-semibold text-popover-foreground">
            No conversations or messages are deleted.
          </strong>{" "}
          Your messages and agent replies stay available.
        </p>
        <p>
          Cleanup is safe and resumable. It pauses if a conversation becomes active or your cleanup
          settings change. Saved space is reclaimed safely on a later startup.
        </p>
      </>
    );
  }

  if (status.task === "optimization") {
    return (
      <>
        <p className="font-semibold text-popover-foreground">Storage optimization</p>
        <p>{progressDescription(status)}</p>
        <p>
          <strong className="font-semibold text-popover-foreground">
            You can keep using Cadencr normally while optimization runs.
          </strong>
        </p>
        <p>
          Cadencr removes verified duplicate command output and moves pasted images to separate
          storage.
        </p>
        <p>
          <strong className="font-semibold text-popover-foreground">
            No conversation information is lost.
          </strong>{" "}
          The retained output and images remain available.
        </p>
        <p>The work resumes automatically if interrupted. Saved space is reclaimed safely.</p>
      </>
    );
  }

  return (
    <>
      <p className="font-semibold text-popover-foreground">Storage status unavailable</p>
      <p>
        Cadencr could not read the storage maintenance update, so the exact operation cannot be
        shown. Check the service logs for details.
      </p>
    </>
  );
}

export function StorageMaintenanceProgress(): React.JSX.Element | null {
  const status = useStorageMaintenanceStore((state) => state.status);
  if (!status) return null;

  const label = statusLabel(status);
  const percentage = status.total > 0 ? Math.round((status.completed / status.total) * 100) : null;
  const indicatorClassName =
    status.phase === "completed"
      ? "bg-[var(--status-ip)]"
      : status.phase === "failed"
        ? "bg-destructive"
        : status.phase === "cancelled"
          ? "bg-muted-foreground"
          : "bg-[var(--acc-orange)]";

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            role="status"
            aria-live="polite"
            tabIndex={0}
            className={cn(
              "w-[90%] cursor-help px-3 pb-1 text-[10px] text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring",
              status.phase === "failed" && "text-destructive",
            )}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{label}</span>
              {percentage !== null && <span className="shrink-0 tabular-nums">{percentage}%</span>}
            </div>
            <ProgressBar
              completed={status.completed}
              total={status.total}
              showCount={false}
              aria-label={label}
              indicatorClassName={indicatorClassName}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          className="w-80 space-y-2 px-3 py-2.5 leading-relaxed"
        >
          <MaintenanceExplanation status={status} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
