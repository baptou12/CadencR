import { useScopedShortcut } from "@/hooks/useShortcut";

interface UseAutoScrollShortcutOptions {
  enabled: boolean;
  onEnableAutoScroll: () => void;
}

/** Enables agent auto-scroll from anywhere in the focused agent tab. */
export function useAutoScrollShortcut({
  enabled,
  onEnableAutoScroll,
}: UseAutoScrollShortcutOptions): void {
  useScopedShortcut(
    "agent-autoscroll",
    (event: KeyboardEvent): void => {
      event.preventDefault();
      onEnableAutoScroll();
    },
    "agent",
    { enabled },
    [onEnableAutoScroll],
  );
}
