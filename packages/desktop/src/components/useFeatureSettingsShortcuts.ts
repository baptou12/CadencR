import type { Dispatch, SetStateAction } from "react";

import { useShortcut } from "@/hooks/useShortcut";

export function useFeatureSettingsShortcuts(
  isSession: boolean,
  setSettingsOpen: Dispatch<SetStateAction<boolean>>,
): void {
  // The registry entry `feature-settings` has both a primary (⌘⇧P) and an
  // `altKeys` alternate (⌥P); `useShortcut` binds both via the resolver.
  useShortcut("feature-settings", (event: KeyboardEvent): void => {
    if (isSession) return;
    event.preventDefault();
    setSettingsOpen((prev) => !prev);
  });
}
