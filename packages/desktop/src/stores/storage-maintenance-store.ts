import { create } from "zustand";

export type StorageMaintenanceTask = "optimization" | "cleanup";
export type StorageMaintenancePhase = "started" | "progress" | "completed" | "cancelled" | "failed";

export interface StorageMaintenanceStatus {
  task: StorageMaintenanceTask | "unknown";
  phase: StorageMaintenancePhase;
  completed: number;
  total: number;
}

interface StorageMaintenanceState {
  status: StorageMaintenanceStatus | null;
}

const TERMINAL_VISIBILITY_MS = 4_000;
let clearTimer: ReturnType<typeof setTimeout> | null = null;

export const useStorageMaintenanceStore = create<StorageMaintenanceState>(() => ({
  status: null,
}));

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function parseStorageMaintenanceStatus(
  payload: Record<string, unknown>,
): StorageMaintenanceStatus | null {
  const task = payload.task;
  const phase = payload.phase;
  const completed = payload.completed;
  const total = payload.total;
  if (
    (task !== "optimization" && task !== "cleanup") ||
    (phase !== "started" &&
      phase !== "progress" &&
      phase !== "completed" &&
      phase !== "cancelled" &&
      phase !== "failed") ||
    !isCount(completed) ||
    !isCount(total) ||
    completed > total ||
    (total === 0 && phase !== "failed")
  ) {
    return null;
  }
  return { task, phase, completed, total };
}

/** Apply a backend-confirmed maintenance update to the global sidebar status. */
export function applyStorageMaintenanceEvent(payload: Record<string, unknown>): void {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
  const status = parseStorageMaintenanceStatus(payload) ?? {
    task: "unknown" as const,
    phase: "failed" as const,
    completed: 0,
    total: 0,
  };
  const current = useStorageMaintenanceStore.getState().status;
  if (
    !current ||
    current.task !== status.task ||
    current.phase !== status.phase ||
    current.completed !== status.completed ||
    current.total !== status.total
  ) {
    useStorageMaintenanceStore.setState({ status });
  }
  if (status.phase === "completed" || status.phase === "cancelled" || status.phase === "failed") {
    clearTimer = setTimeout(clearStorageMaintenanceStatus, TERMINAL_VISIBILITY_MS);
  }
}

/** A disconnected app socket cannot keep stale progress visible. */
export function clearStorageMaintenanceStatus(): void {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
  if (useStorageMaintenanceStore.getState().status) {
    useStorageMaintenanceStore.setState({ status: null });
  }
}
