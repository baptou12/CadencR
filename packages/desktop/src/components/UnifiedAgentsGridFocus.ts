import { useEffect, type RefObject } from "react";
import type { VirtuosoHandle } from "react-virtuoso";

interface UseFocusedUnifiedAgentArgs {
  activeIndex: number;
  activeRow: number;
  focusVersion: number;
  virtuosoRef: RefObject<VirtuosoHandle | null>;
}

export function useFocusedUnifiedAgent({
  activeIndex,
  activeRow,
  focusVersion,
  virtuosoRef,
}: UseFocusedUnifiedAgentArgs): void {
  useEffect(() => {
    if (focusVersion === 0) return undefined;
    let cancelled = false;
    const timeouts: number[] = [];
    const frames: number[] = [];
    const focusAgent = (): boolean => focusUnifiedAgentElement(activeIndex);
    const scheduleFocus = (delayMs: number): void => {
      const timeout = window.setTimeout(() => {
        if (cancelled) return;
        frames.push(requestAnimationFrame(() => !cancelled && focusAgent()));
      }, delayMs);
      timeouts.push(timeout);
    };
    virtuosoRef.current?.scrollToIndex({ index: activeRow, align: "start", behavior: "auto" });
    if (!focusAgent()) [0, 50, 150].forEach(scheduleFocus);
    return () => {
      cancelled = true;
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
      frames.forEach((frame) => cancelAnimationFrame(frame));
    };
  }, [activeIndex, activeRow, focusVersion, virtuosoRef]);
}

function focusUnifiedAgentElement(activeIndex: number): boolean {
  const selector = `[data-unified-agent-index="${activeIndex}"]`;
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) return false;
  element.focus({ preventScroll: true });
  return document.activeElement === element || element.contains(document.activeElement);
}
