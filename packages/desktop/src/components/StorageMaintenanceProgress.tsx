import { ProgressBar } from "@/components/ui/progress-bar";
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
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "w-[90%] px-3 pb-1 text-[10px] text-muted-foreground",
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
  );
}
