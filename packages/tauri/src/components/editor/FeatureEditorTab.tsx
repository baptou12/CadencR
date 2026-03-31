import { useEffect, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useEditorState, useEditorStore } from "@/stores/editor-store";
import { useActiveTab } from "@/hooks/useActiveTab";
import { PanelLeft } from "lucide-react";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
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

interface FeatureEditorTabProps {
  featureId: number;
  projectPath: string;
}

export interface FeatureEditorTabHandle {
  /** Call before leaving the editor tab. Calls `proceed` if allowed. */
  requestLeave: (proceed: () => void) => void;
}

const SIDEBAR_MIN_SIZE = 10;
const SIDEBAR_DEFAULT_SIZE = 18;
const SIDEBAR_MAX_SIZE = 40;

const FeatureEditorTab = forwardRef<FeatureEditorTabHandle, FeatureEditorTabProps>(
  function FeatureEditorTab({ featureId, projectPath }, ref) {
    const { initFeature, splitTree, activePaneId, sidebarVisible, toggleSidebar, panes } = useEditorState(featureId);
    const splitEditorPane = useEditorStore((s) => s.splitEditorPane);
    const navigatePane = useEditorStore((s) => s.navigatePane);
    const { activeTab } = useActiveTab(featureId);
    const isEditorActive = activeTab === "editor";
    const [fileSearchOpen, setFileSearchOpen] = useState(false);
    const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
    const [pendingProceed, setPendingProceed] = useState<(() => void) | null>(null);
    const [isSavingAll, setIsSavingAll] = useState(false);

    const settingKey = `editor_sidebar_visible_${featureId}`;
    const { value: persistedVisible, setValue: persistVisible } = useDebouncedSetting(settingKey);

    /** Collect all dirty tabs across all panes */
    const getDirtyTabs = useCallback(() => {
      return Object.entries(panes).flatMap(([paneId, pane]) =>
        pane.tabs.filter((t) => t.isDirty).map((t) => ({ paneId, filePath: t.filePath })),
      );
    }, [panes]);

    useImperativeHandle(ref, () => ({
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
    }), [getDirtyTabs]);

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

    useHotkeys(
      "meta+p",
      () => setFileSearchOpen(true),
      { preventDefault: true },
      [],
    );

    // Split pane shortcuts — only active when editor tab is selected
    useHotkeys("meta+d", (e) => { e.preventDefault(); splitEditorPane(featureId, activePaneId, "vertical"); }, { enabled: isEditorActive });
    useHotkeys("meta+shift+d", (e) => { e.preventDefault(); splitEditorPane(featureId, activePaneId, "horizontal"); }, { enabled: isEditorActive });
    useHotkeys("meta+alt+left", (e) => { e.preventDefault(); navigatePane(featureId, "left"); }, { enabled: isEditorActive });
    useHotkeys("meta+alt+right", (e) => { e.preventDefault(); navigatePane(featureId, "right"); }, { enabled: isEditorActive });
    useHotkeys("meta+alt+up", (e) => { e.preventDefault(); navigatePane(featureId, "up"); }, { enabled: isEditorActive });
    useHotkeys("meta+alt+down", (e) => { e.preventDefault(); navigatePane(featureId, "down"); }, { enabled: isEditorActive });

    useEffect(() => {
      initFeature();
    }, [initFeature]);

    // Sync persisted sidebar visibility on mount (once)
    useEffect(() => {
      if (persistedVisible !== null) {
        const shouldBeVisible = persistedVisible === "true";
        if (shouldBeVisible !== sidebarVisible) {
          toggleSidebar();
        }
      }
      // Only run on mount when persisted value first loads
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [persistedVisible]);

    function handleToggleSidebar() {
      toggleSidebar();
      persistVisible(String(!sidebarVisible));
    }

    const dirtyCount = getDirtyTabs().length;

    return (
      <div className="flex h-full">
        <FileSearchDialog
          projectPath={projectPath}
          featureId={featureId}
          open={fileSearchOpen}
          onOpenChange={setFileSearchOpen}
        />

        <Dialog open={leaveDialogOpen} onOpenChange={(open) => { if (!open) handleCancelLeave(); }}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Unsaved Changes</DialogTitle>
              <DialogDescription>
                You have unsaved changes in {dirtyCount} file{dirtyCount !== 1 ? "s" : ""}. Switch tab anyway?
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
          <ResizablePanelGroup orientation="horizontal" className="h-full">
            <ResizablePanel
              defaultSize={SIDEBAR_DEFAULT_SIZE}
              minSize={SIDEBAR_MIN_SIZE}
              maxSize={SIDEBAR_MAX_SIZE}
              className="flex flex-col bg-card border-r border-border"
            >
              <SidebarHeader onToggle={handleToggleSidebar} />
              <div className="flex-1 overflow-hidden">
                <FileTree projectPath={projectPath} featureId={featureId} />
              </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={100 - SIDEBAR_DEFAULT_SIZE}>
              <EditorSplitTree node={splitTree} featureId={featureId} projectPath={projectPath} />
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="relative flex flex-col h-full w-full">
            <button
              type="button"
              title="Show sidebar"
              aria-label="Show file tree sidebar"
              className="absolute top-2 left-2 z-10 rounded p-1 hover:bg-accent transition-colors text-muted-foreground"
              onClick={handleToggleSidebar}
            >
              <PanelLeft className="w-4 h-4" />
            </button>
            <EditorSplitTree node={splitTree} featureId={featureId} projectPath={projectPath} />
          </div>
        )}
      </div>
    );
  },
);

export default FeatureEditorTab;

function SidebarHeader({ onToggle }: { onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between px-2 py-1 border-b border-border shrink-0">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Explorer</span>
      <button
        type="button"
        title="Collapse sidebar"
        aria-label="Collapse file tree sidebar"
        className="rounded p-0.5 hover:bg-accent transition-colors text-muted-foreground"
        onClick={onToggle}
      >
        <PanelLeft className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
