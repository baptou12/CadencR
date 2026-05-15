/**
 * Id-based wrappers around the four hot-key engines. Every customizable
 * binding goes through one of these so the registry — and the override
 * store sitting on top of it — is the actual source of truth for which
 * combo fires which action.
 *
 * The underlying hooks (`useHotkeys`, `useScopedHotkeys`,
 * `useGlobalShortcut`, `useScopedGlobalShortcut`) remain available for
 * non-customizable bindings (digit grids, vim chords, bare-escape page
 * dismissals, etc.).
 *
 * Defaults vs. the raw hooks: `enableOnFormTags` /
 * `enableOnContentEditable` default to `true` here because nearly every
 * existing call site set them manually. Callers that need the opposite
 * (e.g. `BranchChip`, sidebar-activate) pass `false` explicitly.
 */
import {
  useHotkeys,
  type HotkeyCallback,
  type Options as HotkeysOptions,
} from "react-hotkeys-hook";
import type { DependencyList } from "react";

import { useResolvedShortcut } from "@/lib/shortcuts/overrides";
import { resolveHotkeyTrigger, tokensToHotkeyString } from "@/lib/shortcuts/resolve";
import type { ShortcutId } from "@/lib/shortcuts/registry";
import { useGlobalShortcut } from "./useGlobalShortcut";
import { useScopedGlobalShortcut, useScopedHotkeys } from "./useScopedHotkeys";
import type { TabKind } from "@/stores/feature-layout-schema";

const HOTKEY_DEFAULTS = {
  enableOnFormTags: true,
  enableOnContentEditable: true,
} as const;

function mergeOptions(options: HotkeysOptions | undefined): HotkeysOptions {
  return options ? { ...HOTKEY_DEFAULTS, ...options } : HOTKEY_DEFAULTS;
}

/**
 * Customizable form-aware shortcut. Equivalent to `useHotkeys` but binds
 * the combo currently resolved for `id` (registry default + any override).
 * `altKeys` in the registry are bound automatically via the array form
 * `react-hotkeys-hook` already supports.
 */
export function useShortcut(
  id: ShortcutId,
  callback: HotkeyCallback,
  options?: HotkeysOptions,
  deps?: DependencyList,
): void {
  const resolved = useResolvedShortcut(id);
  useHotkeys(resolveHotkeyTrigger(resolved), callback, mergeOptions(options), deps);
}

/** Customizable shortcut, gated on which feature-workspace tab has focus. */
export function useScopedShortcut(
  id: ShortcutId,
  callback: HotkeyCallback,
  scope: TabKind,
  options?: HotkeysOptions,
  deps?: DependencyList,
): void {
  const resolved = useResolvedShortcut(id);
  useScopedHotkeys(resolveHotkeyTrigger(resolved), callback, scope, mergeOptions(options), deps);
}

/**
 * Customizable capture-phase shortcut. `useGlobalShortcut` accepts a
 * single combo, so this wrapper deliberately does NOT support `altKeys`
 * — no global-path shortcut needs it today (only `feature-settings`
 * uses alt-keys and that one binds via `useShortcut`).
 */
export function useGlobalShortcutById(
  id: ShortcutId,
  callback: (e: KeyboardEvent) => void,
  options?: { enabled?: boolean },
): void {
  const resolved = useResolvedShortcut(id);
  useGlobalShortcut(tokensToHotkeyString(resolved.keys), callback, options);
}

/** Capture-phase + tab-focus gate. Same `altKeys` caveat as `useGlobalShortcutById`. */
export function useScopedGlobalShortcutById(
  id: ShortcutId,
  callback: (e: KeyboardEvent) => void,
  scope: TabKind,
  options?: { enabled?: boolean },
): void {
  const resolved = useResolvedShortcut(id);
  useScopedGlobalShortcut(tokensToHotkeyString(resolved.keys), callback, scope, options);
}
