import {
  memo,
  useEffect,
  useRef,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import type { EditorView } from "@codemirror/view";
import { useScopedGlobalShortcut, useScopedHotkeys } from "@/hooks/useScopedHotkeys";
import { useEditorState } from "@/hooks/useEditorState";
import { useEditorStore } from "@/stores/editor-store";
import {
  getFocusedTab,
  selectFeatureLayout,
  useFeatureLayoutStore,
} from "@/stores/feature-layout-store";
import { PanelLeft } from "lucide-react";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import EditorSplitTree from "./EditorSplitTree";
import FileTree from "./FileTree";
import FileSearchDialog from "./FileSearchDialog";
import { saveAll } from "./editorSaveRegistry";
import { toast } from "sonner";
import { useFileWatcher } from "@/hooks/useFileWatcher";

interface FeatureEditorTabProps {
  featureId: number;
  projectId: number;
  projectPath: string;
  focusedOverride?: boolean;
}

export interface FeatureEditorTabHandle {
  /** Call before leaving the editor tab. Calls `proceed` if allowed. */
  requestLeave: (proceed: () => void) => void;
  focusActiveEditor: () => void;
}

const SIDEBAR_MIN_SIZE = "120px";
const SIDEBAR_DEFAULT_SIZE = "220px";
const SIDEBAR_MAX_SIZE = "500px";
const EDITOR_SIDEBAR_COLLAPSED_SETTING = "editor_sidebar_collapsed";

const FeatureEditorTab = memo(
  forwardRef<FeatureEditorTabHandle, FeatureEditorTabProps>(function FeatureEditorTab(
    { featureId, projectId, projectPath, focusedOverride },
    ref,
  ) {
    const { initFeature, splitTree, activePaneId, sidebarVisible, toggleSidebar, panes } =
      useEditorState(featureId);
    const splitEditorPane = useEditorStore((s) => s.splitEditorPane);
    const navigatePane = useEditorStore((s) => s.navigatePane);
    // The editor's hotkeys (cmd+P, cmd+D, etc.) only fire while
    // the editor tab is the globally focused feature tab. With split panes,
    // the editor can be visible next to the agent without owning keyboard focus.
    const layoutEditorFocused = useFeatureLayoutStore(
      (s) => getFocusedTab(selectFeatureLayout(featureId)(s)) === "editor",
    );
    const isEditorFocused = focusedOverride ?? layoutEditorFocused;
    const [fileSearchOpen, setFileSearchOpen] = useState(false);
    const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
    const [pendingProceed, setPendingProceed] = useState<(() => void) | null>(null);
    const [isSavingAll, setIsSavingAll] = useState(false);

    const { value: persistedCollapsed, setValue: persistCollapsed } = useDebouncedSetting(
      EDITOR_SIDEBAR_COLLAPSED_SETTING,
      0,
    );
    const hasInitializedRef = useRef(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const editorViewsRef = useRef<Map<string, EditorView>>(new Map());

    useFileWatcher(projectPath);

    const focusActiveEditor = useCallback((): void => {
      editorViewsRef.current.get(activePaneId)?.focus();
    }, [activePaneId]);

    const shouldRestoreEditorFocus = useCallback((): boolean => {
      const active = document.activeElement;
      return !(active instanceof HTMLElement && rootRef.current?.contains(active));
    }, []);

    const handleEditorViewChange = useCallback(
      (paneId: string, view: EditorView | null): void => {
        if (view) {
          editorViewsRef.current.set(paneId, view);
          if (isEditorFocused && paneId === activePaneId && shouldRestoreEditorFocus()) {
            requestAnimationFrame(() => view.focus());
          }
        } else {
          editorViewsRef.current.delete(paneId);
        }
      },
      [activePaneId, isEditorFocused, shouldRestoreEditorFocus],
    );

    /** Collect all dirty tabs across all panes */
    const getDirtyTabs = useCallback(() => {
      return Object.entries(panes).flatMap(([paneId, pane]) =>
        pane.tabs.filter((t) => t.isDirty).map((t) => ({ paneId, filePath: t.filePath })),
      );
    }, [panes]);

    useImperativeHandle(
      ref,
      () => ({
        requestLeave(proceed: () => void) {
          const dirty = getDirtyTabs();
          if (dirty.length === 0) {
            proceed();
          } else {
            // Store proceed as a function in a wrapper to avoid React treating it as a state updater
            setPendingProceed(() => proceed);
            setLeaveDialogOpen(true);
          }
        },
        focusActiveEditor,
      }),
      [focusActiveEditor, getDirtyTabs],
    );

    async function handleSaveAllAndSwitch() {
      const dirty = getDirtyTabs();
      setIsSavingAll(true);
      try {
        await saveAll(dirty);
        setLeaveDialogOpen(false);
        pendingProceed?.();
        setPendingProceed(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to save files";
        toast.error(msg);
      } finally {
        setIsSavingAll(false);
      }
    }

    function handleSwitchWithoutSaving() {
      setLeaveDialogOpen(false);
      pendingProceed?.();
      setPendingProceed(null);
    }

    function handleCancelLeave() {
      setLeaveDialogOpen(false);
      setPendingProceed(null);
    }

    useScopedGlobalShortcut(
      "meta+p",
      (e) => {
        e.preventDefault();
        setFileSearchOpen(true);
      },
      "editor",
      { enabled: isEditorFocused },
    );

    // Split pane + nav shortcuts. Tab-scoped via the wrapper hook.
    useScopedHotkeys(
      "meta+d",
      (e) => {
        e.preventDefault();
        splitEditorPane(featureId, activePaneId, "vertical");
      },
      "editor",
      { enabled: isEditorFocused },
    );
    useScopedHotkeys(
      "meta+shift+d",
      (e) => {
        e.preventDefault();
        splitEditorPane(featureId, activePaneId, "horizontal");
      },
      "editor",
      { enabled: isEditorFocused },
    );
    useScopedHotkeys(
      "meta+alt+left",
      (e) => {
        e.preventDefault();
        navigatePane(featureId, "left");
      },
      "editor",
      { enabled: isEditorFocused },
    );
    useScopedHotkeys(
      "meta+alt+right",
      (e) => {
        e.preventDefault();
        navigatePane(featureId, "right");
      },
      "editor",
      { enabled: isEditorFocused },
    );
    useScopedHotkeys(
      "meta+alt+up",
      (e) => {
        e.preventDefault();
        navigatePane(featureId, "up");
      },
      "editor",
      { enabled: isEditorFocused },
    );
    useScopedHotkeys(
      "meta+alt+down",
      (e) => {
        e.preventDefault();
        navigatePane(featureId, "down");
      },
      "editor",
      { enabled: isEditorFocused },
    );

    useEffect(() => {
      initFeature();
    }, [initFeature]);

    useEffect(() => {
      if (!isEditorFocused || !shouldRestoreEditorFocus()) return undefined;
      const frame = requestAnimationFrame(focusActiveEditor);
      return () => cancelAnimationFrame(frame);
    }, [focusActiveEditor, isEditorFocused, shouldRestoreEditorFocus]);

    // Sync persisted workspace-level sidebar collapse state on first load only.
    useEffect(() => {
      if (hasInitializedRef.current || persistedCollapsed === null) return;
      hasInitializedRef.current = true;
      const shouldBeVisible = persistedCollapsed !== "true";
      if (shouldBeVisible !== sidebarVisible) {
        toggleSidebar();
      }
    }, [persistedCollapsed, sidebarVisible, toggleSidebar]);

    function handleToggleSidebar(): void {
      toggleSidebar();
      persistCollapsed(String(sidebarVisible));
    }

    const dirtyCount = getDirtyTabs().length;

    return (
      <div ref={rootRef} className="flex h-full">
        <FileSearchDialog
          projectId={projectId}
          featureId={featureId}
          open={fileSearchOpen}
          onOpenChange={setFileSearchOpen}
        />

        <Dialog
          open={leaveDialogOpen}
          onOpenChange={(open) => {
            if (!open) handleCancelLeave();
          }}
        >
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Unsaved Changes</DialogTitle>
              <DialogDescription>
                You have unsaved changes in {dirtyCount} file{dirtyCount !== 1 ? "s" : ""}. Switch
                tab anyway?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={handleCancelLeave}>
                Cancel
              </Button>
              <Button variant="outline" onClick={handleSwitchWithoutSaving}>
                Switch Without Saving
              </Button>
              <Button onClick={() => void handleSaveAllAndSwitch()} disabled={isSavingAll}>
                {isSavingAll ? "Saving…" : "Save All & Switch"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {sidebarVisible ? (
          <ResizablePanelGroup id="editor-sidebar" orientation="horizontal" className="h-full">
            <ResizablePanel
              defaultSize={SIDEBAR_DEFAULT_SIZE}
              minSize={SIDEBAR_MIN_SIZE}
              maxSize={SIDEBAR_MAX_SIZE}
              className="flex flex-col bg-card border-r border-border"
            >
              <SidebarHeader onToggle={handleToggleSidebar} />
              <div className="flex-1 overflow-hidden">
                <FileTree projectId={projectId} featureId={featureId} />
              </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel>
              <EditorSplitTree
                node={splitTree}
                featureId={featureId}
                projectId={projectId}
                onEditorViewChange={handleEditorViewChange}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="flex h-full w-full">
            <div className="flex w-9 shrink-0 justify-center border-r border-border bg-card pt-2">
              <button
                type="button"
                title="Show sidebar"
                aria-label="Show file tree sidebar"
                className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={handleToggleSidebar}
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            </div>
            <div className="min-w-0 flex-1">
              <EditorSplitTree
                node={splitTree}
                featureId={featureId}
                projectId={projectId}
                onEditorViewChange={handleEditorViewChange}
              />
            </div>
          </div>
        )}
      </div>
    );
  }),
);

export default FeatureEditorTab;

function SidebarHeader({ onToggle }: { onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between px-2 py-1 border-b border-border shrink-0">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Explorer
      </span>
      <button
        type="button"
        title="Collapse sidebar"
        aria-label="Collapse file tree sidebar"
        className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={onToggle}
      >
        <PanelLeft className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
