import { useEffect } from "react";

/**
 * The living glass background — three drifting, heavily-blurred color halos plus
 * a faint film grain, fixed behind the entire app at `z-index: -1`.
 *
 * Mounted once at the app root. It is theme-agnostic on its own: every visual is
 * driven by CSS variables (`--ambient-*`, `--grain-opacity`) and the whole layer
 * is `display: none` outside the Frost themes (see `theme-frost.css`), so in the
 * six non-glass themes it renders nothing and costs nothing — no paint, no
 * animation. Halo drift freezes automatically under the global motion
 * kill-switch (`html[data-animations="off"]`, which also reflects OS
 * reduced-motion).
 *
 * The one piece of JS motion gating: the drift runs at the display refresh rate
 * (e.g. 120fps), which keeps the GPU compositing every vsync even when the
 * window is hidden or sitting unfocused on another monitor — pure battery waste.
 * We toggle `data-ambient-paused` on <html> on visibility/focus changes and let
 * CSS pause the animation, so a backgrounded window composites zero frames.
 *
 * `aria-hidden` because it is pure decoration.
 */
export function AmbientBackground(): React.JSX.Element {
  useEffect(() => {
    const root = document.documentElement;
    const sync = (): void => {
      const paused = document.hidden || !document.hasFocus();
      root.toggleAttribute("data-ambient-paused", paused);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
      root.removeAttribute("data-ambient-paused");
    };
  }, []);

  return (
    <>
      <div className="ambient" aria-hidden="true">
        <div className="halo" />
      </div>
      <div className="grain" aria-hidden="true" />
      {/* Dimming veil over the halos + grain. The page tint used to live on the
       * translucent `body` background, but `body` must stay non-translucent so
       * the frost `backdrop-filter` blur paints (see theme-frost.css). Rendered
       * last so it sits in front of the ambient/grain layers, behind the app. */}
      <div className="ambient-veil" aria-hidden="true" />
    </>
  );
}
