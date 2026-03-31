import { useEffect, useState } from "react";
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
import EditorSplitTree from "./EditorSplitTree";
import FileTree from "./FileTree";
import FileSearchDialog from "./FileSearchDialog";

interface FeatureEditorTabProps {
  featureId: number;
  projectPath: string;
}

const SIDEBAR_MIN_SIZE = 10;
const SIDEBAR_DEFAULT_SIZE = 18;
const SIDEBAR_MAX_SIZE = 40;

export default function FeatureEditorTab({ featureId, projectPath }: FeatureEditorTabProps) {
  const { initFeature, splitTree, activePaneId, sidebarVisible, toggleSidebar } = useEditorState(featureId);
  const splitEditorPane = useEditorStore((s) => s.splitEditorPane);
  const navigatePane = useEditorStore((s) => s.navigatePane);
  const { activeTab } = useActiveTab(featureId);
  const isEditorActive = activeTab === "editor";
  const [fileSearchOpen, setFileSearchOpen] = useState(false);

  const settingKey = `editor_sidebar_visible_${featureId}`;
  const { value: persistedVisible, setValue: persistVisible } = useDebouncedSetting(settingKey);

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

  return (
    <div className="flex h-full">
      <FileSearchDialog
        projectPath={projectPath}
        featureId={featureId}
        open={fileSearchOpen}
        onOpenChange={setFileSearchOpen}
      />
      {sidebarVisible ? (
        <ResizablePanelGroup direction="horizontal" className="h-full">
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
}

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
