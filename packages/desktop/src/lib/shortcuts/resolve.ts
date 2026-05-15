/**
 * Pure resolver: registry tokens → engine combo string.
 *
 * Both `react-hotkeys-hook`'s `useHotkeys` and our capture-phase
 * `useGlobalShortcut` accept the same `"meta+shift+k"` syntax, so a single
 * converter feeds both engines. Going through this resolver — instead of
 * hand-writing `"meta+b"` at every call site — is what makes the registry
 * the actual source of truth:
 *
 * 1. `mod` becomes `meta` on macOS and `ctrl` everywhere else. The bare
 *    `useGlobalShortcut("meta+b", …)` calls today are dead on Linux/Windows
 *    because Meta is the Win key there; reading through this resolver
 *    fixes that latent bug.
 * 2. Display-only tokens like `plus` / `lbracket` map to the keys the
 *    engines actually match (`equal` / `[`), so the modal can keep
 *    showing `⌘ +` / `⌘ ⇧ [` while the binding works on real keyboards.
 *
 * No React. The override layer in `overrides.ts` wraps this in hooks.
 */
import { PLATFORM_IS_MAC } from "./format";
import { SHORTCUTS, type Shortcut, type ShortcutId, type ShortcutKey } from "./registry";

/**
 * Per-token engine name. Anything not listed falls through verbatim
 * (letters, digits, single chars).
 *
 * Punctuation tokens emit the literal character (`/`, `,`, `[`, `]`, `=`,
 * `-`, `` ` ``) because the two engines parse them differently:
 *  - `react-hotkeys-hook` accepts both word forms (`"slash"`) and literals.
 *  - Our `useGlobalShortcut` matches `e.key` directly, which is the
 *    literal char. Emitting the literal makes a single resolver feed both.
 */
const TOKEN_TO_ENGINE: Record<string, string> = {
  // Modifier: platform-aware. The display formatter already renders ⌘/Ctrl
  // correctly; here we emit the modifier name each engine expects.
  mod: PLATFORM_IS_MAC ? "meta" : "ctrl",
  // Literal control (vim-style ^J etc.). Stable across platforms.
  ctrl: "ctrl",
  alt: "alt",
  shift: "shift",
  enter: "enter",
  escape: "escape",
  tab: "tab",
  space: "space",
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  // `plus` is displayed as `+` but the unshifted key on US layouts is `=`,
  // so the engine has to match `=` to get ⌘+ without requiring shift —
  // same trick the inline `useZoomHotkeys` registration used today.
  plus: "=",
  minus: "-",
  comma: ",",
  slash: "/",
  backtick: "`",
  lbracket: "[",
  rbracket: "]",
};

function tokenToEngine(token: ShortcutKey): string {
  if (token in TOKEN_TO_ENGINE) return TOKEN_TO_ENGINE[token];
  // Single-letter / digit / passthrough — lowercased so `useHotkeys` and
  // `useGlobalShortcut` (both case-insensitive) treat them consistently.
  return token.toLowerCase();
}

/** Convert a registry combo to the `"meta+shift+k"` form both engines accept. */
export function tokensToHotkeyString(keys: ShortcutKey[]): string {
  return keys.map(tokenToEngine).join("+");
}

/**
 * Resolve a shortcut id to its engine trigger.
 *
 * Returns:
 * - `string` for a single-combo shortcut (`"meta+k"`)
 * - `string[]` when the shortcut has `altKeys` so the engine binds both
 *   (`["meta+shift+p", "alt+p"]`)
 *
 * Callers pass the result straight to `useHotkeys` / our `useShortcut`
 * wrapper — `react-hotkeys-hook` already accepts `Keys = string | string[]`.
 */
export function resolveHotkeyTrigger(shortcut: {
  keys: ShortcutKey[];
  altKeys?: ShortcutKey[];
}): string | string[] {
  const primary = tokensToHotkeyString(shortcut.keys);
  if (!shortcut.altKeys || shortcut.altKeys.length === 0) return primary;
  return [primary, tokensToHotkeyString(shortcut.altKeys)];
}

/** Index registry by id once at module load — every call-site lookup is O(1). */
const REGISTRY_BY_ID: ReadonlyMap<ShortcutId, Shortcut> = new Map(
  SHORTCUTS.map((s) => [s.id, s as Shortcut]),
);

/**
 * Default (un-overridden) shortcut for an id. Throws on unknown ids in dev
 * so a typo surfaces immediately; in production the throw still happens —
 * `ShortcutId` typing already prevents the typo from compiling.
 */
export function getRegistryShortcut(id: ShortcutId): Shortcut {
  const entry = REGISTRY_BY_ID.get(id);
  if (!entry) throw new Error(`Unknown shortcut id "${id}"`);
  return entry;
}
