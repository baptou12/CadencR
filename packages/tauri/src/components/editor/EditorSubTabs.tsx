import { useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { X } from "lucide-react";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";
import { cn } from "@/lib/utils";
import { FileSymbolIcon } from "./file-icons";
import { useEditorStore } from "@/stores/editor-store";
import { saveFile } from "./editorSaveRegistry";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface EditorSubTabsProps {
  featureId: number;
  paneId: string;
}

interface PendingClose {
  filePath: string;
  fileName: string;
}

export default function EditorSubTabs({ featureId, paneId }: EditorSubTabsProps) {
  const pane = useEditorStore((s) => s.features[featureId]?.panes[paneId]);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const closeTab = useEditorStore((s) => s.closeTab);

  const [hoveredClose, setHoveredClose] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const tabs = pane?.tabs ?? [];
  const activeFilePath = pane?.activeFilePath ?? null;

  function requestClose(filePath: string, fileName: string, isDirty: boolean) {
    if (isDirty) {
      setPendingClose({ filePath, fileName });
    } else {
      closeTab(featureId, paneId, filePath);
    }
  }

  function handleDiscard() {
    if (!pendingClose) return;
    closeTab(featureId, paneId, pendingClose.filePath);
    setPendingClose(null);
  }

  async function handleSaveAndClose() {
    if (!pendingClose) return;
    setIsSaving(true);
    try {
      await saveFile(paneId, pendingClose.filePath);
      closeTab(featureId, paneId, pendingClose.filePath);
      setPendingClose(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save file";
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  }

  // Next/prev tab navigation (capture-phase so it works with CodeMirror focused)
  useGlobalShortcut("meta+shift+]", (e) => {
    if (!tabs.length) return;
    e.preventDefault();
    const idx = tabs.findIndex((t) => t.filePath === activeFilePath);
    const next = tabs[(idx + 1) % tabs.length];
    if (next) setActiveFile(featureId, paneId, next.filePath);
  });

  useGlobalShortcut("meta+shift+[", (e) => {
    if (!tabs.length) return;
    e.preventDefault();
    const idx = tabs.findIndex((t) => t.filePath === activeFilePath);
    const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
    if (prev) setActiveFile(featureId, paneId, prev.filePath);
  });

  // CMD+W: close active buffer (works even when CodeMirror has focus)
  useHotkeys(
    "meta+w",
    () => {
      if (!activeFilePath) return;
      const tab = tabs.find((t) => t.filePath === activeFilePath);
      if (tab) requestClose(tab.filePath, tab.fileName, tab.isDirty);
    },
    { preventDefault: true, enableOnContentEditable: true, enableOnFormTags: true },
    [tabs, activeFilePath, featureId, paneId],
  );

  if (!tabs.length) return null;

  return (
    <>
      <div className="flex items-center border-b border-border bg-card overflow-x-auto shrink-0 flex-nowrap">
        {tabs.map((tab) => {
          const isActive = activeFilePath === tab.filePath;
          const showClose = !tab.isDirty || hoveredClose === tab.filePath;

          return (
            <button
              key={tab.filePath}
              type="button"
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm border-r border-border whitespace-nowrap shrink-0 hover:bg-accent transition-colors",
                isActive ? "bg-background text-foreground border-t-2 border-t-primary" : "text-muted-foreground",
              )}
              onClick={() => setActiveFile(featureId, paneId, tab.filePath)}
            >
              <FileSymbolIcon fileName={tab.fileName} className="shrink-0 flex items-center" />
              <span>{tab.disambiguatedName}</span>
              <span
                role="button"
                aria-label={`Close ${tab.disambiguatedName}`}
                tabIndex={0}
                className="ml-0.5 rounded hover:bg-muted p-0.5 flex items-center justify-center w-4 h-4"
                onMouseEnter={() => setHoveredClose(tab.filePath)}
                onMouseLeave={() => setHoveredClose(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  requestClose(tab.filePath, tab.fileName, tab.isDirty);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    requestClose(tab.filePath, tab.fileName, tab.isDirty);
                  }
                }}
              >
                {showClose ? (
                  <X className="w-3 h-3" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary block" />
                )}
              </span>
            </button>
          );
        })}
      </div>

      <Dialog open={pendingClose !== null} onOpenChange={(open) => { if (!open) setPendingClose(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Unsaved Changes</DialogTitle>
            <DialogDescription>
              You have unsaved changes in <strong>{pendingClose?.fileName}</strong>. Discard changes?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingClose(null)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={handleDiscard}>
              Discard
            </Button>
            <Button onClick={() => void handleSaveAndClose()} disabled={isSaving}>
              {isSaving ? "Saving…" : "Save & Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
