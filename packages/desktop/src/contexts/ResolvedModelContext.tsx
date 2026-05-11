import { createContext, useContext, type ReactNode } from "react";
import { useResolvedModel } from "@/hooks/useResolvedModel";

export type ResolvedModelValue = ReturnType<typeof useResolvedModel>;

const ResolvedModelContext = createContext<ResolvedModelValue | null>(null);

interface ResolvedModelProviderProps {
  featureId: number;
  projectId: number;
  children: ReactNode;
}

/**
 * Hosts a single `useResolvedModel(featureId, projectId)` call at the route
 * level. Both `WebSocketSessionFeatureBlock` and `FeatureWorkflowView` used to
 * mount the hook separately, doubling the six settings/provider fetches on
 * cold open. They now read from this context instead.
 */
export function ResolvedModelProvider({
  featureId,
  projectId,
  children,
}: ResolvedModelProviderProps): ReactNode {
  const value = useResolvedModel(featureId, projectId);
  return <ResolvedModelContext.Provider value={value}>{children}</ResolvedModelContext.Provider>;
}

export function useResolvedModelContext(): ResolvedModelValue {
  const value = useContext(ResolvedModelContext);
  if (!value) {
    throw new Error("useResolvedModelContext must be used inside <ResolvedModelProvider />");
  }
  return value;
}
