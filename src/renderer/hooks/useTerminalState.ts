import { useState, useCallback, useRef } from "react";

/** State for a single terminal pane */
export interface TerminalPane {
  id: string;
}

/** State for the terminal panel for a given feature */
export interface TerminalPanelState {
  /** Whether the terminal panel is visible */
  isOpen: boolean;
  /** Whether the panel is minimized (PTYs still alive, just hidden) */
  isMinimized: boolean;
  /** Array of active terminal panes */
  panes: TerminalPane[];
}

let paneCounter = 0;
function nextPaneId(): string {
  return `pane-${Date.now()}-${++paneCounter}`;
}

export function useTerminalState(featureId: number) {
  const [state, setState] = useState<TerminalPanelState>({
    isOpen: false,
    isMinimized: false,
    panes: [],
  });

  // Track the current featureId to reset state on navigation
  const featureIdRef = useRef(featureId);
  if (featureIdRef.current !== featureId) {
    featureIdRef.current = featureId;
    // Reset terminal state when switching features
    setState({ isOpen: false, isMinimized: false, panes: [] });
  }

  /** Toggle the terminal panel open/closed. Opens with one pane if none exist. */
  const togglePanel = useCallback(() => {
    setState((prev) => {
      if (prev.isOpen && !prev.isMinimized) {
        // Minimize (hide but keep PTYs alive)
        return { ...prev, isMinimized: true };
      }
      if (prev.isOpen && prev.isMinimized) {
        // Restore from minimized
        return { ...prev, isMinimized: false };
      }
      // Open — create first pane if none exist
      const panes = prev.panes.length > 0 ? prev.panes : [{ id: nextPaneId() }];
      return { isOpen: true, isMinimized: false, panes };
    });
  }, []);

  /** Add a new terminal pane */
  const addPane = useCallback(() => {
    setState((prev) => ({
      ...prev,
      panes: [...prev.panes, { id: nextPaneId() }],
    }));
  }, []);

  /** Remove a pane by ID. If it's the last pane, close the panel entirely. */
  const removePane = useCallback((paneId: string) => {
    setState((prev) => {
      const remaining = prev.panes.filter((p) => p.id !== paneId);
      if (remaining.length === 0) {
        return { isOpen: false, isMinimized: false, panes: [] };
      }
      return { ...prev, panes: remaining };
    });
  }, []);

  /** Minimize the panel (hide without killing PTYs) */
  const minimize = useCallback(() => {
    setState((prev) => ({ ...prev, isMinimized: true }));
  }, []);

  /** Close the panel entirely */
  const closePanel = useCallback(() => {
    setState({ isOpen: false, isMinimized: false, panes: [] });
  }, []);

  return {
    ...state,
    togglePanel,
    addPane,
    removePane,
    minimize,
    closePanel,
  };
}
