import type { ReactElement } from "react";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Lightweight stand-in painted the instant a feature is switched, before the
 * real workspace (agent Virtuoso + Lexical composer + the staged side panels)
 * mounts one frame later. Keeping this first commit cheap is what pulls the
 * switch interaction (INP) off the heavy synchronous mount — see
 * `useDeferredWorkspaceMount` in the `ws-session` route.
 *
 * It mirrors the workspace silhouette (top bar strip + a tab strip + a content
 * area) so the switch reads as "loading this conversation" rather than a blank
 * flash. Deliberately does no layout reads or heavy work of its own.
 */
export function FeatureWorkspaceSkeleton(): ReactElement {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading conversation"
      className="flex h-full min-h-0 flex-col"
    >
      {/* Top bar */}
      <div className="flex h-11 shrink-0 items-center gap-3 px-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-24" />
        <div className="flex-1" />
        <Skeleton className="h-6 w-6 rounded-full" />
      </div>
      {/* Tab strip */}
      <div className="flex h-9 shrink-0 items-center gap-4 px-3">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-14" />
        <Skeleton className="h-4 w-16" />
      </div>
      {/* Content area */}
      <div className="min-h-0 flex-1 px-3 pb-3">
        <div className="flex h-full flex-col justify-end gap-3 rounded-lg border border-border/40 p-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mt-6 h-16 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
