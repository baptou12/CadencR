import type { Dispatch, SetStateAction } from "react";

import { useShortcut } from "@/hooks/useShortcut";

export function useFeatureSettingsShortcuts(
  isSession: boolean,
  setSettingsOpen: Dispatch<SetStateAction<boolean>>,
): void {
  // The registry entry `feature-settings` is bound to ⌥P; `useShortcut`
  // resolves it (plus any user override) via the registry.
  useShortcut("feature-settings", (event: KeyboardEvent): void => {
    if (isSession) return;
    event.preventDefault();
    setSettingsOpen((prev) => !prev);
  });
}
