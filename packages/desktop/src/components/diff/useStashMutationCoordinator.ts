import { useCallback, useMemo } from "react";
import { create } from "zustand";
import type { StashMutationOperation } from "./stash-contracts";

export type StashMutationOwner =
  | { kind: "push" }
  | { kind: "row"; operation: StashMutationOperation; stashRefName: string };

export interface StashMutationLease {
  featureId: number;
  id: number;
  owner: StashMutationOwner;
}

interface StashMutationStore {
  activeByFeature: Record<number, StashMutationLease | undefined>;
  tryAcquire: (featureId: number, owner: StashMutationOwner) => StashMutationLease | null;
  release: (lease: StashMutationLease) => void;
}

let nextLeaseId = 1;

const useStashMutationStore = create<StashMutationStore>((set) => ({
  activeByFeature: {},
  tryAcquire: (featureId, owner) => {
    let acquired: StashMutationLease | null = null;
    set((state) => {
      if (state.activeByFeature[featureId]) return state;
      acquired = { featureId, id: nextLeaseId++, owner };
      return {
        activeByFeature: { ...state.activeByFeature, [featureId]: acquired },
      };
    });
    return acquired;
  },
  release: (lease) =>
    set((state) => {
      if (state.activeByFeature[lease.featureId]?.id !== lease.id) return state;
      const activeByFeature = { ...state.activeByFeature };
      delete activeByFeature[lease.featureId];
      return { activeByFeature };
    }),
}));

export interface StashMutationCoordinator {
  activeMutation: StashMutationOwner | null;
  blockedReason: string | null;
  getBlockedReason: () => string | null;
  tryAcquire: (owner: StashMutationOwner) => StashMutationLease | null;
  release: (lease: StashMutationLease) => void;
}

export function stashMutationBlockedReason(owner: StashMutationOwner | null): string | null {
  if (!owner) return null;
  if (owner.kind === "push") return "Stash changes request in progress";
  const operation = owner.operation[0]?.toUpperCase() + owner.operation.slice(1);
  return `${operation} ${owner.stashRefName} in progress`;
}

/**
 * Feature-keyed single-flight lease shared by the header dialog and stash rows.
 * Zustand's synchronous `set` callback makes acquisition atomic before React
 * can render a disabled state, so same-tick dispatches cannot race through.
 */
export function useStashMutationCoordinator(featureId: number): StashMutationCoordinator {
  const activeLease = useStashMutationStore((state) => state.activeByFeature[featureId]);
  const activeMutation = activeLease?.owner ?? null;
  const blockedReason = stashMutationBlockedReason(activeMutation);

  const getBlockedReason = useCallback(
    (): string | null =>
      stashMutationBlockedReason(
        useStashMutationStore.getState().activeByFeature[featureId]?.owner ?? null,
      ),
    [featureId],
  );
  const tryAcquire = useCallback(
    (owner: StashMutationOwner): StashMutationLease | null =>
      useStashMutationStore.getState().tryAcquire(featureId, owner),
    [featureId],
  );
  const release = useCallback(
    (lease: StashMutationLease): void => useStashMutationStore.getState().release(lease),
    [],
  );

  return useMemo(
    () => ({ activeMutation, blockedReason, getBlockedReason, tryAcquire, release }),
    [activeMutation, blockedReason, getBlockedReason, release, tryAcquire],
  );
}

export function resetStashMutationCoordinatorForTest(): void {
  useStashMutationStore.setState({ activeByFeature: {} });
}
