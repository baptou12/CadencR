import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { useSetWorkspaceSettingWithCache } from "@/hooks/useSetWorkspaceSettingWithCache";
import { ONBOARDING_INTRO_SHOWN_SETTING_KEY } from "@/lib/onboarding-step";
import { ringDots } from "../../../../../landing/src/lib/logo-dots.mjs";
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

// The Index Dots mark: twelve dots on a r14.5 ring around an emerald core on a
// 48 grid (root DESIGN.md "Brand identity"). Precomputed once — each dot's
// index drives its staggered tick-in and cadence-pulse delays in CSS.
const INTRO_DOTS = ringDots();

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
        <svg className="welcome-intro__svg" viewBox="0 0 48 48">
          {INTRO_DOTS.map((dot, i) => (
            <circle
              key={i}
              className="welcome-intro__index-dot"
              style={{ "--dot-index": i } as CSSProperties}
              cx={dot.cx}
              cy={dot.cy}
              r="1.9"
              fill="#eff0f2"
            />
          ))}
          <circle className="welcome-intro__core" cx="24" cy="24" r="5.5" fill="#2db47d" />
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
