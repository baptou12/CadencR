import { useRef, useEffect } from "react";
import { FileIcon, FolderIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileMentionItem {
  path: string;
  isDir: boolean;
}

interface FileMentionPopoverProps {
  open: boolean;
  items: FileMentionItem[];
  selectedIndex: number;
  onSelect: (path: string) => void;
  onClose: () => void;
  children: React.ReactNode;
}

export function FileMentionPopover({
  open,
  items,
  selectedIndex,
  onSelect,
  onClose: _onClose,
  children,
}: FileMentionPopoverProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll selected item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const selected = listRef.current.querySelector("[data-selected='true']");
    selected?.scrollIntoView({ block: "nearest" });
  }, [open, selectedIndex]);

  return (
    <div className="relative min-w-0 flex-1">
      {children}
      {open && items.length > 0 && (
        <div
          ref={listRef}
          className="absolute bottom-full left-0 z-50 mb-1 max-h-[300px] w-[400px] overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg"
        >
          {items.map((item, i) => (
            <button
              key={item.path}
              type="button"
              data-selected={i === selectedIndex}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                i === selectedIndex
                  ? "bg-accent text-accent-foreground"
                  : "text-popover-foreground hover:bg-muted",
              )}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent textarea blur
                onSelect(item.path);
              }}
            >
              {item.isDir ? (
                <FolderIcon className="size-3.5 shrink-0 text-blue-400" />
              ) : (
                <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{item.path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
