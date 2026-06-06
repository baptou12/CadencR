import { useCallback, useEffect, useMemo } from "react";
import { useListProjects, type Project } from "@/api/generated";
import { useSidebarProjectOrderStore } from "@/stores/sidebar-project-order-store";

export function applyOrder(projects: readonly Project[], order: number[] | null): Project[] {
  if (order === null) return [...projects];
  const rank = new Map(order.map((id, index) => [id, index]));
  // Unknown ids (newly created, not yet reconciled into `order`) get rank -1
  // so they sort to the front while keeping their backend relative order via
  // the stable sort.
  return [...projects].sort((a, b) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1));
}

interface UseOrderedProjectsResult {
  /** Projects in the frozen sidebar order (see `sidebar-project-order-store`). */
  projects: Project[];
  /** True while a (manual or background) projects refetch is in flight. */
  isRefreshing: boolean;
  /** Re-fetch projects and re-adopt the backend's canonical sort order. */
  refresh: () => Promise<void>;
}

/**
 * Projects for the sidebar, ordered with a session-stable freeze.
 *
 * The backend sorts projects by most recent user message on every fetch; this
 * hook keeps that order pinned for the session so projects don't jump around
 * as the user works. `refresh()` re-adopts the fresh backend order (used for
 * an explicit manual refresh); a full app reload also re-sorts since the
 * order store is in-memory.
 */
export function useOrderedProjects(): UseOrderedProjectsResult {
  const query = useListProjects();
  const data = query.data;
  const order = useSidebarProjectOrderStore((s) => s.order);
  const reconcile = useSidebarProjectOrderStore((s) => s.reconcile);

  useEffect(() => {
    if (data) reconcile(data.map((p) => p.id));
  }, [data, reconcile]);

  const projects = useMemo(() => applyOrder(data ?? [], order), [data, order]);

  const refresh = useCallback(async (): Promise<void> => {
    const result = await query.refetch();
    if (result.data) {
      useSidebarProjectOrderStore.getState().freeze(result.data.map((p) => p.id));
    }
  }, [query]);

  return { projects, isRefreshing: query.isFetching, refresh };
}
