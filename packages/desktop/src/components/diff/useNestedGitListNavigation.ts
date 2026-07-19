import { useCallback, useEffect, useMemo, useRef } from "react";
import type { VirtualizedListNavigation } from "@/hooks/useVirtualizedListNavigation";
import {
  delegateGitNavigation,
  type GitNavigationAdapter,
  type GitNavigationAdapterRegistrar,
} from "./gitNavigation";

interface NestedGitListNavigationState<T> {
  activeDetailId: string | null;
  list: VirtualizedListNavigation<T>;
  itemId: (item: T) => string;
  closeDetail: () => void;
  backFromList?: () => void;
  delegateDetailBack?: boolean;
}

/** Shared list/detail adapter for Commits, Branches, and Stashes. */
export function useNestedGitListNavigation<T>(
  state: NestedGitListNavigationState<T>,
  register: GitNavigationAdapterRegistrar | undefined,
): GitNavigationAdapterRegistrar {
  const stateRef = useRef(state);
  const detailAdapterRef = useRef<GitNavigationAdapter | null>(null);
  stateRef.current = state;
  const adapter = useMemo<GitNavigationAdapter>(
    () => ({
      getActiveItem: () => {
        const current = stateRef.current;
        if (!current.activeDetailId) {
          const activeItem = current.list.getActiveItem();
          return activeItem ? current.itemId(activeItem) : null;
        }
        return detailAdapterRef.current?.getActiveItem() ?? current.activeDetailId;
      },
      moveSelection: (offset) => {
        const current = stateRef.current;
        return current.activeDetailId
          ? delegateGitNavigation(detailAdapterRef.current, "moveSelection", offset)
          : current.list.moveSelection(offset) != null;
      },
      open: () => {
        const current = stateRef.current;
        return current.activeDetailId
          ? delegateGitNavigation(detailAdapterRef.current, "open")
          : current.list.openActive();
      },
      back: () => {
        const current = stateRef.current;
        if (current.activeDetailId) {
          if (
            current.delegateDetailBack &&
            delegateGitNavigation(detailAdapterRef.current, "back")
          ) {
            return true;
          }
          current.closeDetail();
          return true;
        }
        if (!current.backFromList) return false;
        current.backFromList();
        return true;
      },
      toggleViewed: () => delegateGitNavigation(detailAdapterRef.current, "toggleViewed"),
      scrollHalfPage: (direction) => {
        const current = stateRef.current;
        return current.activeDetailId
          ? delegateGitNavigation(detailAdapterRef.current, "scrollHalfPage", direction)
          : current.list.scrollHalfPage(direction);
      },
      openInEditor: () => delegateGitNavigation(detailAdapterRef.current, "openInEditor"),
    }),
    [],
  );
  useEffect(() => register?.(adapter), [adapter, register]);
  return useCallback<GitNavigationAdapterRegistrar>((detailAdapter) => {
    detailAdapterRef.current = detailAdapter;
    return () => {
      if (detailAdapterRef.current === detailAdapter) detailAdapterRef.current = null;
    };
  }, []);
}
