import { memo, useRef, useEffect, forwardRef, useImperativeHandle, useCallback } from "react";
import { TerminalPanel, type TerminalPanelHandle } from "@/components/terminal/TerminalPanel";
import { useTerminalState, useTerminalStore } from "@/hooks/useTerminalState";

interface FeatureTerminalTabProps {
  featureId: number;
  projectId: number;
  hidden?: boolean;
}

export interface FeatureTerminalTabHandle {
  /** Ensure a terminal pane exists and focus it */
  activate: () => void;
}

export const FeatureTerminalTab = memo(
  forwardRef<FeatureTerminalTabHandle, FeatureTerminalTabProps>(function FeatureTerminalTab(
    { featureId, projectId, hidden },
    ref,
  ) {
    const terminalRef = useRef<TerminalPanelHandle>(null);
    const terminalState = useTerminalState(featureId);

    // Reads fresh state from the store on every call instead of a captured
    // closure. This matters under React StrictMode (and any double-invoke
    // path): the auto-activate effect below fires twice on mount, and a
    // stale closure would see `panes.length === 0` on both calls — calling
    // `addPane()` twice. The second `addPane` lands on a non-null root and
    // *splits* it, leaving the user with a phantom 2-pane terminal before
    // they touch anything. Reading fresh state keeps activation idempotent.
    const activate = useCallback(() => {
      const store = useTerminalStore.getState();
      const fresh = store.getFeature(featureId);
      if (!fresh.root) {
        store.addPane(featureId);
      }
      if (!fresh.isOpen) {
        store.togglePanel(featureId);
      }
      requestAnimationFrame(() => terminalRef.current?.focusActivePane());
    }, [featureId]);

    useImperativeHandle(ref, () => ({ activate }), [activate]);

    // Auto-create a pane and open if none exist when tab becomes visible
    useEffect(() => {
      if (hidden) return;
      activate();
    }, [hidden, activate]);

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
  }),
);
