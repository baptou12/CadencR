import type { Dispatch, SetStateAction } from "react";
import { useHotkeys } from "react-hotkeys-hook";

export function useFeatureSettingsShortcuts(
  isSession: boolean,
  setSettingsOpen: Dispatch<SetStateAction<boolean>>,
): void {
  const toggleSettings = (event: KeyboardEvent): void => {
    if (isSession) return;
    event.preventDefault();
    setSettingsOpen((prev) => !prev);
  };
  useHotkeys("alt+p", toggleSettings, {
    enableOnFormTags: true,
    enableOnContentEditable: true,
  });
  useHotkeys("meta+shift+p", toggleSettings, {
    enableOnFormTags: true,
    enableOnContentEditable: true,
  });
}
