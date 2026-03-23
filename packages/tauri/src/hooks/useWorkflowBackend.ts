/**
 * WorkflowBackend — unified interface for feature workflow state & commands.
 */

// Re-export types and utilities so existing consumers keep working
export {
  deriveViewState,
  type ViewState,
  type WorkflowBackend,
} from "./workflowBackendTypes";

import type { WorkflowBackend } from "./workflowBackendTypes";
import { useWsWorkflowBackend } from "./useWsWorkflowBackend";

export function useWorkflowBackend(
  featureId: number,
  projectId: number,
  _featureType: string,
): WorkflowBackend {
  return useWsWorkflowBackend(featureId, projectId, true);
}
