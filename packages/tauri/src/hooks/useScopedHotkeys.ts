import {
  useHotkeys,
  type HotkeyCallback,
  type Keys,
  type Options as HotkeysOptions,
} from "react-hotkeys-hook";
import { useRef, type DependencyList } from "react";

import { useFeatureLayoutContext } from "@/components/feature-layout/FeatureLayoutContext";
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
function useIsTabFocused(scope: TabKind): boolean {
  const featureId = useFeatureLayoutContext()?.featureId;
  return useFeatureLayoutStore((s) =>
    featureId === undefined
      ? true
      : getFocusedTab(s.features[featureId] ?? EMPTY_LAYOUT_STATE) === scope,
  );
}

export function useScopedHotkeys(
  keys: Keys,
  callback: HotkeyCallback,
  scope: TabKind,
  options?: HotkeysOptions,
  deps?: DependencyList,
): void {
  const isFocused = useIsTabFocused(scope);
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;
  const userEnabled = options?.enabled ?? true;
  // For boolean Triggers we AND the focus gate; for function Triggers we let
  // the user predicate run and rely on the inner callback short-circuit.
  const enabled = typeof userEnabled === "function" ? userEnabled : isFocused && userEnabled;

  // The wrapper reads `isFocused` via a ref so caller-supplied `deps` keep
  // their original semantics — react-hotkeys-hook memoises the wrapper
  // against `deps`, so a closed-over `isFocused` would otherwise stay frozen
  // at the value captured on the first render.
  useHotkeys(
    keys,
    (e, h) => {
      if (!isFocusedRef.current) return;
      callback(e, h);
    },
    { ...options, enabled },
    deps,
  );
}

/** Capture-phase variant for shortcuts that must fire while CodeMirror or xterm holds focus. */
export function useScopedGlobalShortcut(
  shortcut: string,
  callback: (e: KeyboardEvent) => void,
  scope: TabKind,
  options?: { enabled?: boolean },
): void {
  const isFocused = useIsTabFocused(scope);
  useGlobalShortcut(shortcut, callback, { enabled: isFocused && (options?.enabled ?? true) });
}
