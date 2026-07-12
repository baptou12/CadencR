import { useImperativeHandle, type ForwardedRef, type RefObject } from "react";
import type { AgentPromptBarHandle } from "../AgentPromptBar";
import type { AgentSessionHandle } from "./types";

export function useAgentSessionImperativeHandle(
  ref: ForwardedRef<AgentSessionHandle>,
  promptBarRef: RefObject<AgentPromptBarHandle | null>,
  containerRef: RefObject<HTMLDivElement | null>,
  headerRef: RefObject<HTMLDivElement | null>,
  isOpen: boolean,
): void {
  useImperativeHandle(
    ref,
    () => ({
      focusPromptBar: () => promptBarRef.current?.focusInput(),
      focusActiveInput: () => focusActiveInput(containerRef.current, headerRef.current),
      isOpen,
    }),
    [containerRef, headerRef, isOpen, promptBarRef],
  );
}

function focusActiveInput(container: HTMLDivElement | null, header: HTMLDivElement | null): void {
  const permissionButton = container?.querySelector<HTMLElement>("[data-permission-area] button");
  if (focusElement(permissionButton)) return;
  const questionInput = container?.querySelector<HTMLElement>(
    "[data-question-area] button, [data-question-area] input",
  );
  if (focusElement(questionInput)) return;
  const editable = container?.querySelector<HTMLElement>('[contenteditable="true"], textarea');
  if (focusElement(editable)) return;
  focusElement(header);
}

function focusElement(element: HTMLElement | null | undefined): boolean {
  if (!element) return false;
  element.scrollIntoView({ block: "nearest" });
  element.focus();
  return true;
}
