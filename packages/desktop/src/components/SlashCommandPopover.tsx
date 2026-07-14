import { memo, useRef, useEffect } from "react";
import { TerminalIcon, Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CadencrLogo } from "@/components/CadencrLogo";
import { SlidingText } from "@/components/SlidingText";
import type { SlashCommand } from "@/hooks/useSlashCommand";

interface SlashCommandPopoverProps {
  open: boolean;
  items: SlashCommand[];
  selectedIndex: number;
  onSelect: (commandName: string) => void;
  /** Whether the commands query is loading */
  isLoading: boolean;
  triggerChar?: string;
  /** When true, Cadencr virtual skills (`kind === "cadencr"`) are shown but
   * disabled because a required MCP dependency (project or workspace) is off. */
  cadencrDisabled?: boolean;
  children: React.ReactNode;
}

const CADENCR_DISABLED_HINT =
  "Enable the project and workspace MCP (Settings → MCP) to use Cadencr orchestration skills.";

interface SlashCommandItemProps {
  item: SlashCommand;
  selected: boolean;
  disabled: boolean;
  triggerChar: string;
  onSelect: (commandName: string) => void;
}

const SlashCommandItem = memo(function SlashCommandItem({
  item,
  selected,
  disabled,
  triggerChar,
  onSelect,
}: SlashCommandItemProps) {
  const isCadencr = item.kind === "cadencr";
  const selectedDescriptionColor = isCadencr
    ? "text-popover-foreground/80"
    : "text-accent-foreground/80";
  const selectedHintColor = isCadencr ? "text-popover-foreground/70" : "text-accent-foreground/70";
  return (
    <button
      type="button"
      data-selected={selected}
      aria-disabled={disabled}
      title={disabled ? CADENCR_DISABLED_HINT : undefined}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
        selected
          ? isCadencr
            ? "bg-primary/20 text-popover-foreground"
            : "bg-accent text-accent-foreground"
          : isCadencr
            ? // Cadencr virtual skills get a persistent brand-tinted background,
              // with a stronger hover step so pointer and keyboard states remain clear.
              "bg-primary/[0.08] text-popover-foreground hover:bg-primary/20"
            : "text-popover-foreground hover:bg-muted",
        // `disabled` only ever applies to a Cadencr skill, so hold the brand tint
        // static instead of reacting to hover.
        disabled && "cursor-not-allowed opacity-50 hover:bg-primary/[0.08]",
      )}
      onMouseDown={(e) => {
        e.preventDefault(); // prevent textarea blur
        if (disabled) return;
        onSelect(item.name);
      }}
    >
      {isCadencr ? (
        <CadencrLogo className="size-3.5 shrink-0" />
      ) : (
        <TerminalIcon
          className={cn(
            "size-3.5 shrink-0",
            selected ? "text-accent-foreground/80" : "text-muted-foreground",
          )}
        />
      )}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 font-medium">
          {triggerChar}
          {item.name}
        </span>
        {item.description && (
          <SlidingText
            text={item.description}
            // Slower than the app default — skill descriptions run long and
            // should stay comfortably readable as they slide.
            pxPerSec={24}
            className={cn(
              "min-w-0 flex-1 text-xs",
              selected ? selectedDescriptionColor : "text-muted-foreground",
            )}
          />
        )}
      </div>
      {item.argumentHint && (
        <span
          className={cn(
            "shrink-0 text-xs italic",
            selected ? selectedHintColor : "text-muted-foreground/60",
          )}
        >
          {item.argumentHint}
        </span>
      )}
    </button>
  );
});

export function SlashCommandPopover({
  open,
  items,
  selectedIndex,
  onSelect,
  isLoading,
  triggerChar = "/",
  cadencrDisabled = false,
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
          className="glass-surface absolute bottom-full left-0 right-0 z-50 mb-1 max-h-[300px] overflow-y-auto rounded-md border border-border bg-popover py-0 shadow-lg"
        >
          {isLoading ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2Icon className="size-3 animate-spin" />
              Loading commands…
            </div>
          ) : items.length > 0 ? (
            items.map((item, i) => (
              <SlashCommandItem
                key={item.name}
                item={item}
                selected={i === selectedIndex}
                disabled={item.kind === "cadencr" && cadencrDisabled}
                triggerChar={triggerChar}
                onSelect={onSelect}
              />
            ))
          ) : (
            <div className="px-3 py-2 text-xs text-muted-foreground">No matching commands</div>
          )}
        </div>
      )}
    </>
  );
}
