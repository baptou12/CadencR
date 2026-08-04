/**
 * The non-color half of a theme: chassis, tabs, and the texture behind the app.
 *
 * These three traits used to be hardcoded in the stylesheets against specific
 * theme ids — the CadencR pair got the rail chassis and segmented tabs, the
 * Frost pair got the drifting field — which meant a theme *duplicated* from one
 * of them arrived with the colors and none of the shape. Carrying them as data
 * is what makes a copy actually look like what was copied, and what lets any
 * theme opt into any of it.
 *
 * The vocabulary is closed on purpose, exactly like `tokens.ts`: enums and
 * bounded numbers, never CSS text. The single open value is an image asset,
 * which names a file in the theme's own folder — the backend reads it and hands
 * back a `data:` URL, so nothing here ever fetches a URL a theme chose.
 *
 * Mirror of `packages/service/src/domain/themes/chrome.rs` — which is to say,
 * of the types orval generates from it. The leaf types are re-exported from
 * there rather than restated here: they are already total, and a second copy
 * would be a mirror with nothing holding it in line. Only the two containers
 * are local, because the generated `ThemeChrome` and `ThemeTexture` have every
 * field optional (chrome is `#[serde(default)]` on the wire) while a theme
 * definition in this folder always has all of them.
 */

import type {
  ThemeBlend,
  ThemeChassis,
  ThemeGrain,
  ThemeHalo,
  ThemeImage,
  ThemeImageFit,
  ThemeTabs,
} from "@/api/generated";

export type {
  ThemeBlend,
  ThemeChassis,
  ThemeGrain,
  ThemeHalo,
  ThemeImageFit,
  /** How the active pane tab is drawn: `underline` or `segmented`. */
  ThemeTabs,
  /** An image from the theme's own folder, laid over the field. */
  ThemeImage,
};

/**
 * Everything painted behind the app, bottom to top: a flat base, drifting
 * halos, an image, grain, then an optional veil that washes the lot back down
 * with the page background so the UI above it keeps its contrast.
 */
export interface ThemeTexture {
  /** Flat color behind every layer. `null` leaves the page background alone. */
  base: string | null;
  halos: ThemeHalo[];
  image: ThemeImage | null;
  grain: ThemeGrain | null;
  veil: boolean;
}

/** The shape of a theme, as opposed to its palette. */
export interface ThemeChrome {
  chassis: ThemeChassis;
  tabs: ThemeTabs;
  texture: ThemeTexture;
}

/** No texture at all — nothing is rendered and nothing is paid for. */
export const NO_TEXTURE: ThemeTexture = {
  base: null,
  halos: [],
  image: null,
  grain: null,
  veil: false,
};

/**
 * What a theme gets when it says nothing: the flat chassis and underlined tabs
 * that every theme except the CadencR pair has always had.
 */
export const PLAIN_CHROME: ThemeChrome = {
  chassis: "flat",
  tabs: "underline",
  texture: NO_TEXTURE,
};

/** A theme's chrome, or the plain default for one that declares none. */
export function chromeOf(theme: { chrome?: ThemeChrome }): ThemeChrome {
  return theme.chrome ?? PLAIN_CHROME;
}

/** Whether a texture paints anything. An empty one is never rendered. */
export function hasTexture(texture: ThemeTexture): boolean {
  return (
    texture.base !== null ||
    texture.halos.length > 0 ||
    texture.image !== null ||
    texture.grain !== null
  );
}
