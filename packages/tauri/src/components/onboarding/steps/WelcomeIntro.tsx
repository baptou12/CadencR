import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useSetWorkspaceSettingWithCache } from "@/hooks/useSetWorkspaceSettingWithCache";
import { ONBOARDING_INTRO_SHOWN_SETTING_KEY } from "@/lib/onboarding-step";
import "./WelcomeIntro.css";

/**
 * Cinematic intro played once on the very first open of the onboarding.
 *
 * The component is purely presentational — animation, timing, and the
 * settle-into-welcome transition. It tells the parent `WelcomeStep` when to
 * unmount via `onComplete`, and it persists `onboarding_intro_shown=true`
 * so subsequent welcome-step renders (e.g. via "Back" navigation) don't
 * replay it.
 *
 * Click anywhere to skip; the fade-out runs the same way as the timed
 * exit so the welcome content reveals smoothly underneath.
 */
// The intro never auto-dismisses — the user dismisses it explicitly via
// the CTA button, click anywhere, or any key. This gives them as much time
// as they want to read the wordmark/tagline before entering the app.
const FADE_OUT_MS = 600;

export function WelcomeIntro({ onComplete }: { onComplete: () => void }) {
  const [isFading, setIsFading] = useState(false);
  const { setValue: setIntroShown } = useSetWorkspaceSettingWithCache(
    ONBOARDING_INTRO_SHOWN_SETTING_KEY,
  );
  const dismissedRef = useRef(false);

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;

    // Fire and forget. A persistence failure replays the intro on next
    // launch (harmless) — the user has already seen it; we don't want to
    // block the fade-out on the network. The helper toasts on error.
    void setIntroShown("true").catch(() => {});

    setIsFading(true);
    window.setTimeout(onComplete, FADE_OUT_MS);
  }, [setIntroShown, onComplete]);

  // Any non-modifier key dismisses, matching the "or press any key" hint.
  // Pure modifier presses (Shift/Ctrl/Alt/Meta on their own) are ignored so
  // the user doesn't accidentally skip while reaching for a shortcut.
  useEffect(() => {
    const isModifierOnly = (key: string): boolean =>
      key === "Shift" || key === "Control" || key === "Alt" || key === "Meta";
    const onKey = (e: KeyboardEvent): void => {
      if (!isModifierOnly(e.key)) dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  // The CTA button has its own click handler. We don't want a click on the
  // button to bubble up to the overlay's `onClick` (which would also call
  // `dismiss` — harmless, but it makes button-press feedback feel mushy).
  const onCtaClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      dismiss();
    },
    [dismiss],
  );

  return (
    <div
      className={`welcome-intro${isFading ? " welcome-intro--fading" : ""}`}
      onClick={dismiss}
      role="presentation"
      aria-hidden
    >
      <div className="welcome-intro__stage">
        <svg className="welcome-intro__svg" viewBox="0 0 100 100">
          <g transform="rotate(-90 50 50)">
            <circle className="welcome-intro__dot" cx="50" cy="50" r="16" fill="#b388ff" />
            <circle
              className="welcome-intro__ring"
              cx="50"
              cy="50"
              r="28"
              pathLength="360"
              stroke="#454f63"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray="10 20"
              fill="none"
            />
            <g className="welcome-intro__orbit">
              <circle
                className="welcome-intro__arc welcome-intro__arc--green"
                cx="50"
                cy="50"
                r="28"
                pathLength="360"
                stroke="#b2ff59"
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray="40 320"
                fill="none"
                transform="rotate(240 50 50)"
              />
              <circle
                className="welcome-intro__arc welcome-intro__arc--cyan"
                cx="50"
                cy="50"
                r="28"
                pathLength="360"
                stroke="#80d8ff"
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray="40 320"
                fill="none"
                transform="rotate(60 50 50)"
              />
            </g>
          </g>
        </svg>
      </div>

      <div className="welcome-intro__wordmark">Cadencr</div>
      <div className="welcome-intro__accent" />
      <div className="welcome-intro__tagline">Find your rhythm with every agent.</div>

      <button type="button" className="welcome-intro__cta" onClick={onCtaClick}>
        <span className="welcome-intro__cta-label">Let&apos;s find your cadence</span>
        <span className="welcome-intro__cta-arrow" aria-hidden>
          →
        </span>
      </button>

      <div className="welcome-intro__hint">or press any key</div>
    </div>
  );
}
