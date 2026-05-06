import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { OnboardingOverlay } from "./OnboardingOverlay";

/**
 * Renders the onboarding overlay above its children whenever the user
 * hasn't completed (or skipped) the first-run flow. The children are still
 * mounted underneath so that closing the overlay is instant — every query
 * the workspace needs has already resolved by the time the overlay unmounts.
 *
 * While the persisted step is loading we render the children only. The
 * `useGetWorkspaceSetting` query returns `value: null` for unset keys, so
 * `parseOnboardingStep` will land on `"welcome"` and the overlay opens
 * immediately on first run without an extra round-trip.
 */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { isLoading, isCompleted } = useOnboardingStatus();
  return (
    <>
      {children}
      {!isLoading && !isCompleted ? <OnboardingOverlay /> : null}
    </>
  );
}
