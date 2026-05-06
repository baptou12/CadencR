import { useEffect, useRef } from "react";
import { getActiveFocusZone } from "@/lib/focus-zones";

const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[role="combobox"]',
].join(", ");

const OPEN_OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  "[data-radix-popper-content-wrapper]",
].join(", ");

interface UseAgentLetterFocusOptions {
  enabled: boolean;
  onFocus: () => void;
}

export function isAgentFocusLetterKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.isComposing || event.key === "Process") return false;
  return event.key.length === 1 && /^\p{L}$/u.test(event.key);
}

export function shouldFocusAgentFromKeydown(event: KeyboardEvent): boolean {
  if (!isAgentFocusLetterKey(event)) return false;
  const focusZone = getActiveFocusZone();
  if (focusZone && focusZone !== "main-content") return false;
  if (hasTextSelection()) return false;
  if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return false;
  return !isOverlayTarget(document.activeElement);
}

export function useAgentLetterFocus({ enabled, onFocus }: UseAgentLetterFocusOptions): void {
  const onFocusRef = useRef(onFocus);

  useEffect(() => {
    onFocusRef.current = onFocus;
  }, [onFocus]);

  useEffect(() => {
    if (!enabled) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!shouldFocusAgentFromKeydown(event)) return;
      onFocusRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);
}

function hasTextSelection(): boolean {
  const selection = window.getSelection();
  return !!selection && selection.rangeCount > 0 && !selection.isCollapsed;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(EDITABLE_SELECTOR) !== null;
}

function isOverlayTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(OPEN_OVERLAY_SELECTOR) !== null;
}
