import { useEffect } from "react";
import { create } from "zustand";

import type { GitOperationKind } from "@/api/generated";

export interface GitUpdateRecovery {
  operation: GitOperationKind;
  conflictFiles: string[];
  conflictBatch: number;
  needsUncommittedView: boolean;
  baselineComputedAt: number;
  operationObserved: boolean;
  settling: boolean;
}

export interface RecordConflictInput {
  featureId: number;
  operation: GitOperationKind;
  conflictFiles: string[];
  computedAt: number;
  statusOperation: GitOperationKind | null;
}

interface MarkSettlingInput {
  featureId: number;
  operation: GitOperationKind;
  computedAt: number;
}

interface GitUpdateRecoveryStore {
  byFeature: Record<number, GitUpdateRecovery>;
  recordConflicts: (input: RecordConflictInput) => void;
  markUncommittedViewHandled: (featureId: number) => void;
  markSettling: (input: MarkSettlingInput) => void;
  syncStatus: (featureId: number, operation: GitOperationKind | null, computedAt: number) => void;
}

export const useGitUpdateRecoveryStore = create<GitUpdateRecoveryStore>((set) => ({
  byFeature: {},

  recordConflicts(input) {
    set((state) => {
      const existing = state.byFeature[input.featureId];
      return {
        byFeature: {
          ...state.byFeature,
          [input.featureId]: {
            operation: input.operation,
            conflictFiles: input.conflictFiles,
            conflictBatch: (existing?.conflictBatch ?? 0) + 1,
            needsUncommittedView: true,
            baselineComputedAt: Math.max(existing?.baselineComputedAt ?? 0, input.computedAt),
            operationObserved:
              existing?.operationObserved === true || input.statusOperation !== null,
            settling: false,
          },
        },
      };
    });
  },

  markUncommittedViewHandled(featureId) {
    set((state) => updateRecovery(state, featureId, { needsUncommittedView: false }));
  },

  markSettling(input) {
    set((state) => {
      const existing = state.byFeature[input.featureId];
      const recovery: GitUpdateRecovery = existing
        ? { ...existing, settling: true }
        : {
            operation: input.operation,
            conflictFiles: [],
            conflictBatch: 0,
            needsUncommittedView: false,
            baselineComputedAt: input.computedAt,
            operationObserved: true,
            settling: true,
          };
      return {
        byFeature: { ...state.byFeature, [input.featureId]: recovery },
      };
    });
  },

  syncStatus(featureId, operation, computedAt) {
    set((state) => syncRecoveryStatus(state, featureId, operation, computedAt));
  },
}));

function updateRecovery(
  state: GitUpdateRecoveryStore,
  featureId: number,
  update: Partial<GitUpdateRecovery>,
): Pick<GitUpdateRecoveryStore, "byFeature"> | GitUpdateRecoveryStore {
  const recovery = state.byFeature[featureId];
  if (!recovery) return state;
  return {
    byFeature: { ...state.byFeature, [featureId]: { ...recovery, ...update } },
  };
}

function syncRecoveryStatus(
  state: GitUpdateRecoveryStore,
  featureId: number,
  operation: GitOperationKind | null,
  computedAt: number,
): Pick<GitUpdateRecoveryStore, "byFeature"> | GitUpdateRecoveryStore {
  const recovery = state.byFeature[featureId];
  if (!recovery) return state;
  if (operation) {
    if (recovery.operation === operation && recovery.operationObserved) return state;
    return updateRecovery(state, featureId, { operation, operationObserved: true });
  }
  if (recovery.operationObserved || computedAt > recovery.baselineComputedAt) {
    return removeRecovery(state, featureId);
  }
  return state;
}

function removeRecovery(
  state: GitUpdateRecoveryStore,
  featureId: number,
): Pick<GitUpdateRecoveryStore, "byFeature"> | GitUpdateRecoveryStore {
  if (!state.byFeature[featureId]) return state;
  const { [featureId]: _removed, ...remaining } = state.byFeature;
  return { byFeature: remaining };
}

export function recordGitUpdateConflicts(input: RecordConflictInput): void {
  useGitUpdateRecoveryStore.getState().recordConflicts(input);
}

export function markGitUpdateSettling(input: MarkSettlingInput): void {
  useGitUpdateRecoveryStore.getState().markSettling(input);
}

export function effectiveGitUpdateConflictCount(
  statusOperation: GitOperationKind | null,
  statusConflictCount: number,
  statusComputedAt: number,
  recovery: GitUpdateRecovery | undefined,
): number {
  if (!recovery) return statusConflictCount;
  if (statusOperation && statusComputedAt > recovery.baselineComputedAt) {
    return statusConflictCount;
  }
  return recovery.conflictFiles.length;
}

export function useSyncGitUpdateRecovery(
  featureId: number,
  operation: GitOperationKind | null,
  computedAt: number,
): void {
  useEffect(() => {
    useGitUpdateRecoveryStore.getState().syncStatus(featureId, operation, computedAt);
  }, [computedAt, featureId, operation]);
}
