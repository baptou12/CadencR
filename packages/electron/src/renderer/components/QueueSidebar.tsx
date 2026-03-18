/**
 * QueueSidebar — displays the execution queue for a workflow.
 *
 * Items are grouped by group_index; items sharing a group are shown in a
 * "parallel" container. Click an item to select it in the main panel.
 */

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  CheckCircle2Icon,
  CircleIcon,
  LockIcon,
  PlayCircleIcon,
  XCircleIcon,
  PauseCircleIcon,
  SkipForwardIcon,
  Loader2Icon,
} from "lucide-react";
import type { QueueItem, QueueItemStatus } from "@/hooks/useWorkflowWebSocket";

// ---------------------------------------------------------------------------
// Status icon mapping
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<QueueItemStatus, { icon: React.ReactNode; className: string; label: string }> = {
  pending: { icon: <CircleIcon className="size-3.5" />, className: "text-gray-500", label: "Pending" },
  blocked: { icon: <LockIcon className="size-3.5" />, className: "text-gray-600", label: "Blocked" },
  ready: { icon: <PlayCircleIcon className="size-3.5" />, className: "text-yellow-400", label: "Ready" },
  running: { icon: <Loader2Icon className="size-3.5 animate-spin" />, className: "text-blue-400", label: "Running" },
  paused: { icon: <PauseCircleIcon className="size-3.5" />, className: "text-yellow-400", label: "Paused" },
  completed: { icon: <CheckCircle2Icon className="size-3.5" />, className: "text-green-400", label: "Completed" },
  error: { icon: <XCircleIcon className="size-3.5" />, className: "text-red-400", label: "Error" },
  skipped: { icon: <SkipForwardIcon className="size-3.5" />, className: "text-gray-500", label: "Skipped" },
};

// ---------------------------------------------------------------------------
// Group items by group_index
// ---------------------------------------------------------------------------

interface ItemGroup {
  groupIndex: number | null;
  items: QueueItem[];
}

function groupItems(queue: QueueItem[]): ItemGroup[] {
  const groups: ItemGroup[] = [];
  const sorted = [...queue].sort((a, b) => a.order_index - b.order_index);

  for (const item of sorted) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.groupIndex != null && lastGroup.groupIndex === item.group_index) {
      lastGroup.items.push(item);
    } else {
      groups.push({ groupIndex: item.group_index, items: [item] });
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface QueueSidebarProps {
  queue: QueueItem[];
  selectedItemId: number | null;
  onSelectItem: (itemId: number) => void;
  className?: string;
}

export function QueueSidebar({ queue, selectedItemId, onSelectItem, className }: QueueSidebarProps) {
  const groups = useMemo(() => groupItems(queue), [queue]);

  if (queue.length === 0) {
    return (
      <div className={cn("flex items-center justify-center p-4 text-sm text-gray-500", className)}>
        No queue items yet
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col overflow-y-auto", className)}>
      <div className="border-b border-gray-800 px-3 py-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-gray-400">
          Execution Queue
        </h3>
      </div>
      <div className="flex flex-col gap-0.5 p-1.5">
        {groups.map((group, gi) => (
          <div key={gi}>
            {group.items.length > 1 ? (
              <div className="rounded-md border border-gray-800/50 bg-gray-900/30 p-1">
                <div className="mb-0.5 px-1.5 text-[10px] font-medium uppercase tracking-wider text-gray-600">
                  Parallel
                </div>
                {group.items.map(item => (
                  <QueueItemRow
                    key={item.id}
                    item={item}
                    isSelected={selectedItemId === item.id}
                    onClick={() => onSelectItem(item.id)}
                  />
                ))}
              </div>
            ) : (
              group.items.map(item => (
                <QueueItemRow
                  key={item.id}
                  item={item}
                  isSelected={selectedItemId === item.id}
                  onClick={() => onSelectItem(item.id)}
                />
              ))
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual row
// ---------------------------------------------------------------------------

function QueueItemRow({ item, isSelected, onClick }: { item: QueueItem; isSelected: boolean; onClick: () => void }) {
  const config = STATUS_CONFIG[item.status];
  const label = item.phase_title ?? item.item_type;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        "hover:bg-gray-800/60",
        isSelected && "bg-gray-800/80 ring-1 ring-gray-700",
        item.status === "running" && "animate-pulse-subtle",
      )}
    >
      <span className={cn("shrink-0", config.className)}>{config.icon}</span>
      <span className="min-w-0 truncate text-gray-300">{label}</span>
    </button>
  );
}
