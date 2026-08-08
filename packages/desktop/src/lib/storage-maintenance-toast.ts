import { toast } from "sonner";

const STORAGE_MAINTENANCE_TOAST_ID = "storage-maintenance";

type StorageMaintenanceEvent =
  | { phase: "started"; features: number; window_days: number }
  | { phase: "completed"; features: number; rewritten_messages: number }
  | {
      phase: "cancelled";
      completed_features: number;
      remaining_features: number;
      rewritten_messages: number;
    }
  | {
      phase: "failed";
      completed_features: number;
      failed_features: number;
      rewritten_messages: number;
    };

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseStorageMaintenanceEvent(
  payload: Record<string, unknown>,
): StorageMaintenanceEvent | null {
  if (
    payload.phase === "started" &&
    isCount(payload.features) &&
    isCount(payload.window_days) &&
    payload.window_days > 0
  ) {
    return {
      phase: payload.phase,
      features: payload.features,
      window_days: payload.window_days,
    };
  }
  if (
    payload.phase === "completed" &&
    isCount(payload.features) &&
    isCount(payload.rewritten_messages)
  ) {
    return {
      phase: payload.phase,
      features: payload.features,
      rewritten_messages: payload.rewritten_messages,
    };
  }
  if (
    payload.phase === "cancelled" &&
    isCount(payload.completed_features) &&
    isCount(payload.remaining_features) &&
    isCount(payload.rewritten_messages)
  ) {
    return {
      phase: payload.phase,
      completed_features: payload.completed_features,
      remaining_features: payload.remaining_features,
      rewritten_messages: payload.rewritten_messages,
    };
  }
  if (
    payload.phase === "failed" &&
    isCount(payload.completed_features) &&
    isCount(payload.failed_features) &&
    isCount(payload.rewritten_messages)
  ) {
    return {
      phase: payload.phase,
      completed_features: payload.completed_features,
      failed_features: payload.failed_features,
      rewritten_messages: payload.rewritten_messages,
    };
  }
  return null;
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/** Update one persistent toast throughout an archived-storage sweep. */
export function showStorageMaintenanceToast(payload: Record<string, unknown>): void {
  const event = parseStorageMaintenanceEvent(payload);
  if (!event) {
    toast.error("Storage maintenance status could not be read.", {
      id: STORAGE_MAINTENANCE_TOAST_ID,
    });
    return;
  }

  if (event.phase === "started") {
    toast.loading("Optimizing archived storage…", {
      id: STORAGE_MAINTENANCE_TOAST_ID,
      description: `${plural(event.features, "conversation")} archived and quiet for at least ${plural(event.window_days, "day")} will be checked. Only oversized Bash output is compacted; conversations and messages are not deleted.`,
    });
    return;
  }

  if (event.phase === "completed") {
    const description =
      event.rewritten_messages === 0
        ? `Checked ${plural(event.features, "archived conversation")}. Nothing needed trimming; no conversations or messages were deleted.`
        : `Compacted ${plural(event.rewritten_messages, "oversized tool payload")} across ${plural(event.features, "archived conversation")}. No conversations or messages were deleted.`;
    toast.success("Archived storage optimized", {
      id: STORAGE_MAINTENANCE_TOAST_ID,
      description,
    });
    return;
  }

  if (event.phase === "cancelled") {
    toast.info("Storage optimization stopped", {
      id: STORAGE_MAINTENANCE_TOAST_ID,
      description: `Storage settings changed during the sweep. ${plural(event.remaining_features, "archived conversation")} left untouched; no conversations or messages were deleted.`,
    });
    return;
  }

  const attemptedFeatures = event.completed_features + event.failed_features;
  const description =
    event.failed_features === 0
      ? "The archived conversation sweep could not start. It will retry later; no conversations or messages were deleted."
      : `${plural(event.failed_features, "conversation")} out of ${attemptedFeatures} could not be fully optimized and will be retried. No conversations or messages were deleted.`;
  toast.error("Storage optimization incomplete", {
    id: STORAGE_MAINTENANCE_TOAST_ID,
    description,
  });
}

/** Ensure a dropped app socket cannot leave an infinite loading toast behind. */
export function dismissStorageMaintenanceToast(): void {
  toast.dismiss(STORAGE_MAINTENANCE_TOAST_ID);
}
