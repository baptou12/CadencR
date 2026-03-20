/**
 * WorkflowBackend — unified interface for feature workflow state & commands.
 *
 * Both the legacy tRPC backend and the new WS-based workflow engine implement
 * this interface. The dispatcher hook picks the right adapter based on
 * `featureType`.
 */

// Re-export types and utilities so existing consumers keep working
export {
  deriveViewState,
  type ViewState,
  type WorkflowBackend,
} from "./workflowBackendTypes";

import type { WorkflowBackend } from "./workflowBackendTypes";
import { useTrpcWorkflowBackend } from "./useTrpcWorkflowBackend";
import { useWsWorkflowBackend } from "./useWsWorkflowBackend";

// ---------------------------------------------------------------------------
// Dispatcher hook
// ---------------------------------------------------------------------------

export function useWorkflowBackend(
  featureId: number,
  projectId: number,
  featureType: string,
): WorkflowBackend {
  // Always call both hooks to maintain stable hook order (Rules of Hooks).
  const isWs = featureType === "ws-feature";
  const wsBackend = useWsWorkflowBackend(featureId, projectId, isWs);
  const trpcBackend = useTrpcWorkflowBackend(featureId, projectId);

  return isWs ? wsBackend : trpcBackend;
}
