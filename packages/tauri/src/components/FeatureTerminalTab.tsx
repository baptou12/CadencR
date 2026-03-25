import { useRef, useEffect } from "react";
import { TerminalPanel, type TerminalPanelHandle } from "@/components/terminal/TerminalPanel";
import { useTerminalState } from "@/hooks/useTerminalState";

interface FeatureTerminalTabProps {
  featureId: number;
  projectId: number;
  hidden?: boolean;
}

export function FeatureTerminalTab({ featureId, projectId, hidden }: FeatureTerminalTabProps) {
  const terminalRef = useRef<TerminalPanelHandle>(null);
  const terminalState = useTerminalState(featureId);

  // Auto-create a pane and open if none exist when tab becomes visible
  useEffect(() => {
    if (hidden) return;
    if (terminalState.panes.length === 0) {
      terminalState.addPane();
    }
    if (!terminalState.isOpen) {
      terminalState.togglePanel();
    }
    requestAnimationFrame(() => terminalRef.current?.focusActivePane());
  }, [hidden]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={hidden ? "hidden" : "h-full"}>
      <TerminalPanel
        ref={terminalRef}
        featureId={featureId}
        projectId={projectId}
        state={terminalState}
        togglePanel={terminalState.togglePanel}
        addPane={terminalState.addPane}
        removePane={terminalState.removePane}
        minimize={terminalState.minimize}
      />
    </div>
  );
}
