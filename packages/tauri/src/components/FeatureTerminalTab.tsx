import {
  memo,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useCallback,
  useMemo,
} from "react";
import { TerminalPanel, type TerminalPanelHandle } from "@/components/terminal/TerminalPanel";
import { useTerminalState, useTerminalStore } from "@/hooks/useTerminalState";
import { useGetFeatureSettings, useListProjects } from "@/api/generated";
import {
  getFocusedTab,
  isTabVisible,
  selectFeatureLayout,
  useFeatureLayoutStore,
} from "@/stores/feature-layout-store";

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
    const isTerminalVisible = useFeatureLayoutStore((s) =>
      isTabVisible(selectFeatureLayout(featureId)(s), "terminal"),
    );
    const isTerminalFocused = useFeatureLayoutStore(
      (s) => getFocusedTab(selectFeatureLayout(featureId)(s)) === "terminal",
    );

    // Compute the cwd a freshly-spawned terminal *would* end up in, given the
    // current feature settings: the worktree if one was created, otherwise the
    // project root. The `feature.updated` WS event invalidates feature
    // settings after a worktree is created, so this stays reactive without
    // any extra wiring.
    const { data: featureSettingsData } = useGetFeatureSettings(featureId);
    const worktreePath = useMemo(
      () => featureSettingsData?.find((s) => s.key === "worktree_path")?.value ?? null,
      [featureSettingsData],
    );
    const projectsQuery = useListProjects();
    const projectPath = useMemo(
      () => projectsQuery.data?.find((p) => p.id === projectId)?.path ?? null,
      [projectsQuery.data, projectId],
    );
    const expectedCwd = worktreePath ?? projectPath;

    // Reads fresh state from the store on every call instead of a captured
    // closure. This matters under React StrictMode (and any double-invoke
    // path): the auto-activate effect below fires twice on mount, and a
    // stale closure would see `panes.length === 0` on both calls — calling
    // `addPane()` twice. The second `addPane` lands on a non-null root and
    // *splits* it, leaving the user with a phantom 2-pane terminal before
    // they touch anything. Reading fresh state keeps activation idempotent.
    const ensureTerminalOpen = useCallback((): void => {
      const store = useTerminalStore.getState();
      const fresh = store.getFeature(featureId);
      if (!fresh.root) {
        store.addPane(featureId);
      }
      if (!fresh.isOpen) {
        store.togglePanel(featureId);
      }
    }, [featureId]);

    const activate = useCallback((): void => {
      ensureTerminalOpen();
      requestAnimationFrame(() => terminalRef.current?.focusActivePane());
    }, [ensureTerminalOpen]);

    useImperativeHandle(ref, () => ({ activate }), [activate]);

    // Auto-create a pane and open if none exist when the terminal tab is visible,
    // but only move real DOM focus there when this pane is the focused one.
    useEffect(() => {
      if (hidden || !isTerminalVisible) return;
      ensureTerminalOpen();
    }, [hidden, ensureTerminalOpen, isTerminalVisible]);

    useEffect(() => {
      if (hidden || !isTerminalFocused) return;
      activate();
    }, [hidden, activate, isTerminalFocused]);

    return (
      <div className={hidden ? "hidden" : "h-full"}>
        <TerminalPanel
          ref={terminalRef}
          featureId={featureId}
          projectId={projectId}
          state={terminalState}
          splitPane={terminalState.splitPane}
          removePane={terminalState.removePane}
          expectedCwd={expectedCwd}
        />
      </div>
    );
  }),
);
