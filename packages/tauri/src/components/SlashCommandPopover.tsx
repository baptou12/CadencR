import { useRef, useEffect } from "react";
import { TerminalIcon, Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SlashCommand } from "@/hooks/useSlashCommand";

interface SlashCommandPopoverProps {
  open: boolean;
  items: SlashCommand[];
  selectedIndex: number;
  onSelect: (commandName: string) => void;
  /** Whether the commands query is loading */
  isLoading: boolean;
  children: React.ReactNode;
}

export function SlashCommandPopover({
  open,
  items,
  selectedIndex,
  onSelect,
  isLoading,
  children,
}: SlashCommandPopoverProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll selected item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const selected = listRef.current.querySelector("[data-selected='true']");
    selected?.scrollIntoView({ block: "nearest" });
  }, [open, selectedIndex]);

  return (
    <>
      {children}
      {open && (
        <div
          ref={listRef}
          className="absolute bottom-full left-0 z-50 mb-1 w-80 max-h-[300px] overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg"
        >
          {isLoading ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2Icon className="size-3 animate-spin" />
              Loading commands…
            </div>
          ) : items.length > 0 ? (
            items.map((item, i) => (
              <button
                key={item.name}
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
                  onSelect(item.name);
                }}
              >
                <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="shrink-0 font-medium">/{item.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {item.description}
                  </span>
                </span>
                {item.argumentHint && (
                  <span className="shrink-0 text-xs italic text-muted-foreground/60">
                    {item.argumentHint}
                  </span>
                )}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              No matching commands
            </div>
          )}
        </div>
      )}
    </>
  );
}
