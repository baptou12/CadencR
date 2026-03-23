import { createContext, useContext } from "react";

export interface CodeBlockActions {
  /** Send a command string to the integrated terminal (opens/splits if needed) */
  sendToTerminal?: (command: string) => void;
}

export const CodeBlockActionsContext = createContext<CodeBlockActions>({});

export function useCodeBlockActions() {
  return useContext(CodeBlockActionsContext);
}
