/**
 * Returns the live WS-pushed feature title (from auto-naming), or null if
 * no rename has been received yet.  Checks both the workflow store (for the
 * active workflow feature) and the ws-session store (for session-mode features).
 *
 * Consumers should fall back to the HTTP-fetched title when this returns null.
 */
import { useWsSessionStore } from "@/stores/ws-session-store";
import { useWorkflowStore } from "@/hooks/useWorkflowWebSocket";
import { wsSessionIdFromFeature } from "@/lib/ws-session-id";

export interface FeatureTitleState {
  title: string | null;
  isAutoNaming: boolean;
}

export function useFeatureTitle(featureId: number): FeatureTitleState {
  const workflowTitle = useWorkflowStore((s) =>
    s.featureId === featureId ? s.featureTitle : null,
  );
  const workflowAutoNaming = useWorkflowStore((s) =>
    s.featureId === featureId ? s.isAutoNaming : false,
  );
  const sessionTitle = useWsSessionStore(
    (s) => s.sessions[wsSessionIdFromFeature(featureId)]?.featureTitle ?? null,
  );
  const sessionAutoNaming = useWsSessionStore(
    (s) => s.sessions[wsSessionIdFromFeature(featureId)]?.isAutoNaming ?? false,
  );
  return {
    title: workflowTitle ?? sessionTitle,
    isAutoNaming: workflowAutoNaming || sessionAutoNaming,
  };
}
