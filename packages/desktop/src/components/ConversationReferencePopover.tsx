import { memo, useEffect, useRef } from "react";
import { ArchiveIcon, Loader2Icon, MessageSquareIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/api-errors";
import { FeatureStatus } from "@/api/generated";
import type { ConversationReferenceItem } from "@/hooks/useConversationReference";

interface ConversationReferencePopoverProps {
  items: ConversationReferenceItem[];
  selectedIndex: number;
  isLoading: boolean;
  error: unknown;
  disabled: boolean;
  onSelect: (featureId: number) => void;
}

const ConversationReferenceRow = memo(function ConversationReferenceRow({
  item,
  selected,
  onSelect,
}: {
  item: ConversationReferenceItem;
  selected: boolean;
  onSelect: (featureId: number) => void;
}) {
  return (
    <button
      type="button"
      data-selected={selected}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
        selected ? "bg-accent text-accent-foreground" : "text-popover-foreground hover:bg-muted",
      )}
      onMouseDown={(event) => {
        event.preventDefault();
        onSelect(item.feature_id);
      }}
    >
      <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-medium">{item.feature_title}</span>
      <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
        {item.project_name}
      </span>
      {item.feature_status === FeatureStatus.archived && (
        <ArchiveIcon className="size-3 shrink-0 text-muted-foreground" aria-label="Archived" />
      )}
    </button>
  );
});

export function ConversationReferencePopover({
  items,
  selectedIndex,
  isLoading,
  error,
  disabled,
  onSelect,
}: ConversationReferencePopoverProps) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const selected = listRef.current?.querySelector("[data-selected='true']");
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  let status: string | null = null;
  if (disabled) status = "Enable the workspace MCP in Settings → MCP to reference conversations.";
  else if (error) status = apiErrorMessage(error, "Could not load conversations");
  else if (!isLoading && items.length === 0) status = "No matching conversations";

  return (
    <div
      ref={listRef}
      className="glass-surface max-h-[300px] w-[420px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg"
    >
      {isLoading ? (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" />
          Loading conversations…
        </div>
      ) : status ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">{status}</div>
      ) : (
        items.map((item, index) => (
          <ConversationReferenceRow
            key={item.feature_id}
            item={item}
            selected={index === selectedIndex}
            onSelect={onSelect}
          />
        ))
      )}
    </div>
  );
}
