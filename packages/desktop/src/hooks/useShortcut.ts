/**
 * Id-based wrappers around the four hot-key engines. Every customizable
 * binding goes through one of these so the registry — and the override
 * store sitting on top of it — is the actual source of truth for which
 * combo fires which action.
 *
 * The underlying hooks (`useAppHotkeys`, `useScopedHotkeys`,
 * `useGlobalShortcut`, `useScopedGlobalShortcut`) remain available for
 * non-customizable bindings (digit grids, vim chords, bare-escape page
 * dismissals, etc.).
 *
 * Defaults vs. TanStack's raw hooks: input/contenteditable shortcuts are
 * enabled and matching is layout-aware through `@tanstack/hotkeys`.
 */
import type { HotkeyCallback } from "@tanstack/hotkeys";
import type { DependencyList } from "react";

import { useResolvedShortcut } from "@/lib/shortcuts/overrides";
import { resolveHotkeyTrigger } from "@/lib/shortcuts/resolve";
import type { ShortcutId } from "@/lib/shortcuts/registry";
import { useAppHotkeys, type ShortcutHotkeyOptions } from "./useAppHotkeys";
import { useGlobalShortcut } from "./useGlobalShortcut";
import { useScopedGlobalShortcut, useScopedHotkeys } from "./useScopedHotkeys";
import type { TabKind } from "@/stores/feature-layout-schema";

const SHORTCUT_DEFAULTS = {
  enableOnContentEditable: true,
  enableOnFormTags: true,
} as const;

function mergeShortcutOptions(options: ShortcutHotkeyOptions | undefined): ShortcutHotkeyOptions {
  return options ? { ...SHORTCUT_DEFAULTS, ...options } : SHORTCUT_DEFAULTS;
}

/**
 * Customizable form-aware shortcut. Equivalent to `useHotkeys` but binds
 * the combo currently resolved for `id` (registry default + any override).
 * `altKeys` in the registry are bound automatically via the array form
 * TanStack's array registration supports.
 */
export function useShortcut(
  id: ShortcutId,
  callback: HotkeyCallback,
  options?: ShortcutHotkeyOptions,
  deps?: DependencyList,
): void {
  const resolved = useResolvedShortcut(id);
  useAppHotkeys(resolveHotkeyTrigger(resolved), callback, mergeShortcutOptions(options), deps);
}

/** Customizable shortcut, gated on which feature-workspace tab has focus. */
export function useScopedShortcut(
  id: ShortcutId,
  callback: HotkeyCallback,
  scope: TabKind,
  options?: ShortcutHotkeyOptions,
  deps?: DependencyList,
): void {
  const resolved = useResolvedShortcut(id);
  useScopedHotkeys(
    resolveHotkeyTrigger(resolved),
    callback,
    scope,
    mergeShortcutOptions(options),
    deps,
  );
}

/**
 * Customizable capture-phase shortcut. Binds the registry default combo
 * plus any `altKeys` — needed for actions whose canonical key sits in
 * different physical positions across layouts (e.g. `Mod+/` on QWERTY,
 * `Mod+?` on AZERTY where `/` requires Shift+:).
 */
export function useGlobalShortcutById(
  id: ShortcutId,
  callback: (e: KeyboardEvent) => void,
  options?: { enabled?: boolean },
): void {
  const resolved = useResolvedShortcut(id);
  useGlobalShortcut(resolveHotkeyTrigger(resolved), callback, options);
}

/** Capture-phase + tab-focus gate. */
export function useScopedGlobalShortcutById(
  id: ShortcutId,
  callback: (e: KeyboardEvent) => void,
  scope: TabKind,
  options?: { enabled?: boolean },
): void {
  const resolved = useResolvedShortcut(id);
  useScopedGlobalShortcut(resolveHotkeyTrigger(resolved), callback, scope, options);
}
