import type { LexicalEditor } from "lexical";
import { useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { shouldFocusPromptFromSurfaceClick } from "@/components/agent-prompt-focus";

export function useUnifiedAgentsFilterShellFocus(
  editor: LexicalEditor,
): (event: ReactMouseEvent<HTMLElement>) => void {
  return useCallback(
    (event: ReactMouseEvent<HTMLElement>): void => {
      if (event.defaultPrevented || !shouldFocusPromptFromSurfaceClick(event.target)) return;
      event.preventDefault();
      editor.getRootElement()?.focus();
    },
    [editor],
  );
}
