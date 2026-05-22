import type { HotkeyCallback } from "@tanstack/hotkeys";
import { useMemo, useRef, type DependencyList } from "react";

import { useFeatureLayoutContext } from "@/components/feature-layout/FeatureLayoutContext";
import {
  useAppHotkeys,
  type ShortcutHotkeyOptions,
  type ShortcutKeys,
} from "@/hooks/useAppHotkeys";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";
import { getFocusedTab, useFeatureLayoutStore } from "@/stores/feature-layout-store";
import { EMPTY_LAYOUT_STATE, type TabKind } from "@/stores/feature-layout-schema";

/**
 * Tabs in the feature view stay mounted (display-toggled), so every tab's
 * hotkey hooks fire concurrently. These wrappers gate callbacks on the
 * focused tab — the active tab of the pane that owns keyboard focus.
 *
 * `featureId` is read from `FeatureLayoutContext`; outside a provider the
 * gate is inert (callback always fires) so storybook/tests don't need to
 * wrap.
 */
export function useIsTabFocused(scope: TabKind): boolean {
  const context = useFeatureLayoutContext();
  const featureId = context?.featureId;
  const hotkeysEnabled = context?.hotkeysEnabled ?? true;
  return useFeatureLayoutStore((s) =>
    featureId === undefined
      ? hotkeysEnabled
      : hotkeysEnabled && getFocusedTab(s.features[featureId] ?? EMPTY_LAYOUT_STATE) === scope,
  );
}

export function useScopedHotkeys(
  keys: ShortcutKeys,
  callback: HotkeyCallback,
  scope: TabKind,
  options?: ShortcutHotkeyOptions,
  deps?: DependencyList,
): void {
  const isFocused = useIsTabFocused(scope);
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;
  const userEnabled = options?.enabled ?? true;
  const enabled = isFocused && userEnabled;
  const scopedOptions = useMemo<ShortcutHotkeyOptions>(
    () => ({ ...options, enabled }),
    [enabled, options],
  );

  // The wrapper reads `isFocused` via a ref so caller-supplied `deps` keep
  // their original semantics while TanStack keeps callbacks fresh.
  useAppHotkeys(
    keys,
    (e, h) => {
      if (!isFocusedRef.current) return;
      callback(e, h);
    },
    scopedOptions,
    deps,
  );
}

/** Capture-phase variant for shortcuts that must fire while CodeMirror or xterm holds focus. */
export function useScopedGlobalShortcut(
  shortcut: string | readonly string[],
  callback: (e: KeyboardEvent) => void,
  scope: TabKind,
  options?: { enabled?: boolean },
): void {
  const isFocused = useIsTabFocused(scope);
  useGlobalShortcut(shortcut, callback, { enabled: isFocused && (options?.enabled ?? true) });
}
