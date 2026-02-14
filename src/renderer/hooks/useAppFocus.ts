import { useCallback } from "react";
import { useFocusContext } from "@/contexts/FocusContext";
import type { FocusZone } from "@/contexts/FocusContext";

const ZONE_ORDER: FocusZone[] = [
  "left-sidebar",
  "main-content",
  "right-sidebar",
];

export function useAppFocus() {
  const { focusZone, setFocusZone } = useFocusContext();

  const isFocused = useCallback(
    (zone: FocusZone) => focusZone === zone,
    [focusZone],
  );

  const moveFocusLeft = useCallback(() => {
    const currentIndex = ZONE_ORDER.indexOf(focusZone);
    const nextIndex =
      (currentIndex - 1 + ZONE_ORDER.length) % ZONE_ORDER.length;
    setFocusZone(ZONE_ORDER[nextIndex]);
  }, [focusZone, setFocusZone]);

  const moveFocusRight = useCallback(() => {
    const currentIndex = ZONE_ORDER.indexOf(focusZone);
    const nextIndex = (currentIndex + 1) % ZONE_ORDER.length;
    setFocusZone(ZONE_ORDER[nextIndex]);
  }, [focusZone, setFocusZone]);

  return {
    focusZone,
    setFocusZone,
    isFocused,
    moveFocusLeft,
    moveFocusRight,
  };
}
