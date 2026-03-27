import { useRef, useEffect, forwardRef, useImperativeHandle, useCallback } from "react";
import { TerminalPanel, type TerminalPanelHandle } from "@/components/terminal/TerminalPanel";
import { useTerminalState } from "@/hooks/useTerminalState";

interface FeatureTerminalTabProps {
  featureId: number;
  projectId: number;
  hidden?: boolean;
}

export interface FeatureTerminalTabHandle {
  /** Ensure a terminal pane exists and focus it */
  activate: () => void;
}

export const FeatureTerminalTab = forwardRef<FeatureTerminalTabHandle, FeatureTerminalTabProps>(
  function FeatureTerminalTab({ featureId, projectId, hidden }, ref) {
    const terminalRef = useRef<TerminalPanelHandle>(null);
    const terminalState = useTerminalState(featureId);

    const activate = useCallback(() => {
      if (terminalState.panes.length === 0) {
        terminalState.addPane();
      }
      if (!terminalState.isOpen) {
        terminalState.togglePanel();
      }
      requestAnimationFrame(() => terminalRef.current?.focusActivePane());
    }, [terminalState]);

    useImperativeHandle(ref, () => ({ activate }), [activate]);

    // Auto-create a pane and open if none exist when tab becomes visible
    useEffect(() => {
      if (hidden) return;
      activate();
    }, [hidden]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
      <div className={hidden ? "hidden" : "h-full"}>
        <TerminalPanel
          ref={terminalRef}
          featureId={featureId}
          projectId={projectId}
          state={terminalState}
          splitPane={terminalState.splitPane}
          removePane={terminalState.removePane}
        />
      </div>
    );
  },
);
