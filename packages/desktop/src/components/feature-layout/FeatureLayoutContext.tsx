import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Threads layout-scoped state to descendants of a feature view so hotkeys can
 * be gated on the active tab and, in embedded views, on the active agent card.
 */
interface FeatureLayoutContextValue {
  featureId: number;
  hotkeysEnabled: boolean;
}

const FeatureLayoutContext = createContext<FeatureLayoutContextValue | null>(null);

interface FeatureLayoutProviderProps {
  featureId: number;
  hotkeysEnabled?: boolean;
  children: ReactNode;
}

export function FeatureLayoutProvider({
  featureId,
  hotkeysEnabled = true,
  children,
}: FeatureLayoutProviderProps): ReactNode {
  const value = useMemo(() => ({ featureId, hotkeysEnabled }), [featureId, hotkeysEnabled]);
  return <FeatureLayoutContext.Provider value={value}>{children}</FeatureLayoutContext.Provider>;
}

export function useFeatureLayoutContext(): FeatureLayoutContextValue | null {
  return useContext(FeatureLayoutContext);
}
