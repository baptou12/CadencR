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
 * reduced-motion), so there's no JS motion gating to do here.
 *
 * `aria-hidden` because it is pure decoration.
 */
export function AmbientBackground(): React.JSX.Element {
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
