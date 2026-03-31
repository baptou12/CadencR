import { useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";

interface EditorSubTabsProps {
  featureId: number;
  paneId: string;
}

export default function EditorSubTabs({ featureId, paneId }: EditorSubTabsProps) {
  const pane = useEditorStore((s) => s.features[featureId]?.panes[paneId]);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const closeTab = useEditorStore((s) => s.closeTab);

  const [hoveredClose, setHoveredClose] = useState<string | null>(null);

  const tabs = pane?.tabs ?? [];
  const activeFilePath = pane?.activeFilePath ?? null;

  function confirmClose(filePath: string, isDirty: boolean) {
    if (isDirty) {
      if (!window.confirm("Unsaved changes. Discard?")) return;
    }
    closeTab(featureId, paneId, filePath);
  }

  // Next/prev tab navigation
  useHotkeys(
    "meta+alt+]",
    () => {
      if (!tabs.length) return;
      const idx = tabs.findIndex((t) => t.filePath === activeFilePath);
      const next = tabs[(idx + 1) % tabs.length];
      if (next) setActiveFile(featureId, paneId, next.filePath);
    },
    { preventDefault: true },
    [tabs, activeFilePath, featureId, paneId],
  );

  useHotkeys(
    "meta+alt+[",
    () => {
      if (!tabs.length) return;
      const idx = tabs.findIndex((t) => t.filePath === activeFilePath);
      const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
      if (prev) setActiveFile(featureId, paneId, prev.filePath);
    },
    { preventDefault: true },
    [tabs, activeFilePath, featureId, paneId],
  );

  useHotkeys(
    "meta+w",
    () => {
      if (!activeFilePath) return;
      const tab = tabs.find((t) => t.filePath === activeFilePath);
      if (tab) confirmClose(tab.filePath, tab.isDirty);
    },
    { preventDefault: true },
    [tabs, activeFilePath, featureId, paneId],
  );

  if (!tabs.length) return null;

  return (
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
                confirmClose(tab.filePath, tab.isDirty);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  confirmClose(tab.filePath, tab.isDirty);
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
  );
}
