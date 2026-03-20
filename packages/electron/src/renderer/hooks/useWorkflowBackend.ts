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

// ---------------------------------------------------------------------------
// Stub adapters (replaced in subsequent phases)
// ---------------------------------------------------------------------------

function useWsWorkflowBackend(
  _featureId: number,
  _projectId: number,
): WorkflowBackend {
  throw new Error("useWsWorkflowBackend not yet implemented");
}

// ---------------------------------------------------------------------------
// Dispatcher hook
// ---------------------------------------------------------------------------

export function useWorkflowBackend(
  featureId: number,
  projectId: number,
  featureType: string,
): WorkflowBackend {
  if (featureType === "ws-feature") {
    return useWsWorkflowBackend(featureId, projectId);
  }
  return useTrpcWorkflowBackend(featureId, projectId);
}
