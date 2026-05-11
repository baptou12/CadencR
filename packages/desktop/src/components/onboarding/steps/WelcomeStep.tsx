import { useCallback, useState } from "react";
import { useGetWorkspaceSetting } from "@/api/generated";
import { ONBOARDING_INTRO_SHOWN_SETTING_KEY } from "@/lib/onboarding-step";
import { OnboardingFooter } from "../OnboardingFooter";
import type { OnboardingStepProps } from "../OnboardingOverlay";
import { WelcomeIntro } from "./WelcomeIntro";

/**
 * Step 1 — short welcome copy explaining what Cadencr is. No action other
 * than acknowledging and moving on. We deliberately omit a "Skip" button
 * here because skipping the welcome is equivalent to "Skip onboarding",
 * which already lives in the overlay header.
 *
 * On the very first open of the onboarding we play `WelcomeIntro` over the
 * step content. The intro persists `onboarding_intro_shown=true` once it
 * finishes; we keep a local `introClosed` boolean so the intro stays mounted
 * for the full fade-out animation (the cache update would otherwise flip
 * `persistedShown` to true mid-fade and unmount the intro instantly).
 */
export function WelcomeStep({ isPersisting, onAdvance, onBack }: OnboardingStepProps) {
  const introQuery = useGetWorkspaceSetting(ONBOARDING_INTRO_SHOWN_SETTING_KEY);
  const [introClosed, setIntroClosed] = useState(false);
  const onIntroComplete = useCallback(() => setIntroClosed(true), []);

  // Wait for the query to resolve before deciding — otherwise we'd flash the
  // welcome copy for one frame on first launch before the intro mounts.
  const persistedShown = introQuery.data?.value === "true";
  const shouldShowIntro = !introQuery.isLoading && !persistedShown && !introClosed;

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAdvance();
        }}
        className="flex flex-col gap-8"
      >
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">Welcome to Cadencr</h1>
          <p className="text-base text-muted-foreground leading-relaxed">
            One workspace for Claude, OpenCode, and Codex. We&apos;ll take a minute to detect your
            installed agent CLIs, pick a project folder, and choose a default agent — then drop you
            straight into your first prompt.
          </p>
        </div>

        <OnboardingFooter
          primaryLabel="Get started"
          onPrimary={onAdvance}
          primaryDisabled={isPersisting}
          onBack={onBack}
        />
      </form>

      {shouldShowIntro ? <WelcomeIntro onComplete={onIntroComplete} /> : null}
    </>
  );
}
