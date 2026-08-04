import { memo, useEffect, useMemo } from "react";
import { useTheme } from "@/hooks/useTheme";
import { chromeOf, hasTexture, type ThemeHalo, type ThemeTexture } from "@/lib/themes/chrome";

/**
 * The texture behind the app — the active theme's drifting halos, image and
 * grain, fixed at `z-index: -1` under everything.
 *
 * Every layer comes from `theme.chrome.texture` rather than from a stylesheet
 * keyed on a theme id, which is what lets a theme duplicated from Frost keep
 * its field, and any other theme describe one of its own. A theme with no
 * texture renders nothing at all: no element, no blend, no compositing.
 *
 * The one piece of JS motion gating: drift runs at the display refresh rate
 * (e.g. 120fps), which keeps the GPU compositing every vsync even when the
 * window is hidden or sitting unfocused on another monitor — pure battery
 * waste. We toggle `data-ambient-paused` on <html> on visibility/focus changes
 * and let CSS pause the animation, so a backgrounded window composites zero
 * frames. Drift also freezes under the global motion kill-switch
 * (`html[data-animations="off"]`, which reflects OS reduced-motion).
 *
 * `aria-hidden` because it is pure decoration.
 */
export function AmbientBackground(): React.JSX.Element | null {
  const { theme } = useTheme();
  const texture = chromeOf(theme).texture;
  const painted = hasTexture(texture);

  useEffect(() => {
    if (!painted) return;
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
  }, [painted]);

  if (!painted) return null;
  return <TextureLayers texture={texture} assets={theme.assets ?? NO_ASSETS} />;
}

/** Stable identity, so a built-in theme's layers don't re-render on every
 *  settings change that passes through `useTheme`. */
const NO_ASSETS: Record<string, string> = {};

const TextureLayers = memo(function TextureLayers({
  texture,
  assets,
}: {
  texture: ThemeTexture;
  assets: Record<string, string>;
}): React.JSX.Element {
  const { base, halos, image, grain, veil } = texture;
  const imageUrl = image ? assets[image.asset] : undefined;

  return (
    <>
      <div
        className="ambient"
        aria-hidden="true"
        style={base === null ? undefined : { backgroundColor: base }}
      >
        {halos.map((halo, index) => (
          <Halo key={index} halo={halo} index={index} />
        ))}
      </div>

      {image && imageUrl ? (
        <div
          className="texture-image"
          aria-hidden="true"
          style={{
            backgroundImage: `url("${imageUrl}")`,
            backgroundSize: image.fit === "tile" ? `${image.scale}px` : image.fit,
            backgroundRepeat: image.fit === "tile" ? "repeat" : "no-repeat",
            opacity: image.opacity,
            mixBlendMode: image.blend,
          }}
        />
      ) : null}

      {grain ? (
        <div
          className="grain"
          aria-hidden="true"
          style={{
            backgroundColor: grain.color,
            maskImage: GRAIN_MASK,
            maskSize: `${grain.scale}px`,
            opacity: grain.opacity,
            mixBlendMode: grain.blend,
          }}
        />
      ) : null}

      {/* Rendered last so it dims the layers above the page background rather
       * than being dimmed by them. This is the tint a translucent `body` used
       * to cast, moved off `body` because a partial-alpha backdrop root stops
       * `backdrop-filter` painting entirely (see theme-frost.css). */}
      {veil ? <div className="ambient-veil" aria-hidden="true" /> : null}
    </>
  );
});

/**
 * A halo is positioned by its centre, so `size` (a diameter in `vw`) is pulled
 * back by half on each axis with margins rather than a transform — `transform`
 * belongs to the drift animation, and the two would fight.
 */
function Halo({ halo, index }: { halo: ThemeHalo; index: number }): React.JSX.Element {
  const style = useMemo(
    () => ({
      width: `${halo.size}vw`,
      height: `${halo.size}vw`,
      left: `${halo.x}%`,
      top: `${halo.y}%`,
      marginLeft: `${-halo.size / 2}vw`,
      marginTop: `${-halo.size / 2}vw`,
      background: `radial-gradient(circle, ${halo.color}, transparent 70%)`,
      // No `filter` at all at zero, rather than `blur(0px)`: any filter value
      // gives the element its own rasterization pass, redone on every resize.
      filter: halo.blur > 0 ? `blur(${halo.blur}px)` : undefined,
      opacity: halo.opacity,
      // Three drift paths, handed out in rotation: a theme with several halos
      // gets motion that never lines up. `steps()` caps the composited frames
      // at a few per second — see `theme-chrome.css`.
      animationName: halo.drift > 0 ? `cadencr-drift-${(index % 3) + 1}` : undefined,
      animationDuration: halo.drift > 0 ? `${halo.drift}s` : undefined,
    }),
    [halo, index],
  );
  return <div className="halo" style={style} />;
}

/**
 * The grain speckle, as an alpha mask rather than a colored image: the theme's
 * own `grain.color` fills the layer and this only decides where it shows. That
 * is what makes the color configurable at all — tinting the noise itself would
 * mean baking RGB into an feColorMatrix.
 *
 * `fractalNoise` at 0.7 with three octaves is the same speckle the Frost themes
 * have always used; the 0.7 alpha row keeps its density identical.
 */
const GRAIN_MASK =
  `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'>` +
  `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='3' stitchTiles='stitch'/>` +
  `<feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.7 0'/></filter>` +
  `<rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`;
