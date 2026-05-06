import { useScopedHotkeys } from "@/hooks/useScopedHotkeys";

interface UseAutoScrollShortcutOptions {
  enabled: boolean;
  onEnableAutoScroll: () => void;
}

/** Enables agent auto-scroll from anywhere in the focused agent tab. */
export function useAutoScrollShortcut({
  enabled,
  onEnableAutoScroll,
}: UseAutoScrollShortcutOptions): void {
  useScopedHotkeys(
    "meta+shift+s",
    (event: KeyboardEvent): void => {
      event.preventDefault();
      onEnableAutoScroll();
    },
    "agent",
    {
      enabled,
      enableOnFormTags: true,
      enableOnContentEditable: true,
    },
    [onEnableAutoScroll],
  );
}
