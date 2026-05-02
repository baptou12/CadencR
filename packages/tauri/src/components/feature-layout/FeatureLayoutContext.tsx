import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Threads `featureId` to descendants of the feature view so `useScopedHotkeys`
 * can gate shortcuts on the active tab without each consumer plumbing
 * `featureId` through props. Outside the provider, scoped hotkeys behave like
 * unscoped ones (no gate) — keeps storybook / unit tests usable.
 */
interface FeatureLayoutContextValue {
  featureId: number;
}

const FeatureLayoutContext = createContext<FeatureLayoutContextValue | null>(null);

interface FeatureLayoutProviderProps {
  featureId: number;
  children: ReactNode;
}

export function FeatureLayoutProvider({
  featureId,
  children,
}: FeatureLayoutProviderProps): ReactNode {
  const value = useMemo(() => ({ featureId }), [featureId]);
  return <FeatureLayoutContext.Provider value={value}>{children}</FeatureLayoutContext.Provider>;
}

export function useFeatureLayoutContext(): FeatureLayoutContextValue | null {
  return useContext(FeatureLayoutContext);
}
