/**
 * QueueSidebar — displays the execution queue for a workflow.
 *
 * Shows plan title, PRD button, progress bar, and queue items grouped by
 * step (group_index), styled to match PlanSidebar's information density.
 */

import { useMemo, useState } from "react";
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
  RotateCcwIcon,
  FileText,
  ChevronDownIcon,
  ChevronRightIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/Markdown";
import { useGetFeaturePlan, useGetFeaturePrd } from "@/api/generated";
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
// Type label formatting
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<string, string> = {
  plan: "Plan",
  prd: "PRD",
  execute: "Execute",
  review: "Review",
  risk: "Risk",
  qa: "QA",
  retro: "Retro",
  "review-fixer": "Review Fixer",
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
  const sorted = [...queue].toSorted((a, b) => a.order_index - b.order_index);

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
  featureId?: number;
  selectedItemId: number | null;
  onSelectItem: (itemId: number) => void;
  onRetryItem?: (itemId: number) => void;
  onSkipItem?: (itemId: number) => void;
  className?: string;
}

export function QueueSidebar({ queue, featureId, selectedItemId, onSelectItem, onRetryItem, onSkipItem, className }: QueueSidebarProps) {
  const groups = useMemo(() => groupItems(queue), [queue]);
  const [expandedItemId, setExpandedItemId] = useState<number | null>(null);
  const [showPrd, setShowPrd] = useState(false);

  const { data: plan } = useGetFeaturePlan(featureId ?? 0, { enabled: featureId != null && featureId > 0 });
  const { data: prdData } = useGetFeaturePrd(featureId ?? 0, { enabled: featureId != null && featureId > 0 });
  const prd = prdData?.prd;

  // Build a map from phase_id to phase data for quick lookup
  const phaseMap = useMemo(() => {
    if (!plan?.phases) return new Map<number, (typeof plan.phases)[number]>();
    const m = new Map<number, (typeof plan.phases)[number]>();
    for (const p of plan.phases) {
      m.set(p.id, p);
    }
    return m;
  }, [plan]);

  // Progress
  const completedCount = queue.filter(i => i.status === "completed" || i.status === "skipped").length;
  const totalCount = queue.length;

  if (queue.length === 0 && !plan && !prd) {
    return (
      <div className={cn("flex items-center justify-center p-4 text-sm text-gray-500", className)}>
        No queue items yet
      </div>
    );
  }

  return (
    <>
      <div className={cn("flex flex-col overflow-y-auto", className)}>
        {/* Plan header */}
        {plan && (
          <div className="border-b border-gray-800 px-3 py-2.5">
            <h3 className="truncate text-sm font-semibold text-foreground">{plan.title}</h3>
            {plan.summary && (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{plan.summary}</p>
            )}
          </div>
        )}

        {/* PRD button + Progress */}
        <div className="border-b border-gray-800 px-3 py-2 flex flex-col gap-1.5">
          {prd && (
            <button
              type="button"
              onClick={() => setShowPrd(true)}
              className="flex items-center gap-2 rounded-md border border-[var(--drac-purple)]/40 bg-[var(--drac-purple)]/15 px-2 py-1.5 text-left transition-colors hover:bg-[var(--drac-purple)]/25"
            >
              <FileText className="size-3.5 shrink-0 text-[var(--drac-purple)]" />
              <span className="text-xs font-medium text-foreground">PRD</span>
            </button>
          )}
          {totalCount > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-green-500 transition-all duration-300"
                  style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
                />
              </div>
              <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                {completedCount}/{totalCount}
              </span>
            </div>
          )}
        </div>

        {/* Queue items grouped by step */}
        <div className="flex flex-col gap-0.5 p-1.5">
          {groups.map((group, gi) => (
            <div key={gi}>
              {/* Step divider */}
              <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-muted-foreground">
                <span className="flex-1 border-t border-border/50" />
                <span className="shrink-0">Step {(group.groupIndex ?? gi) + 1}</span>
                <span className="flex-1 border-t border-border/50" />
              </div>
              {group.items.map(item => (
                <QueueItemRow
                  key={item.id}
                  item={item}
                  phase={item.phase_id != null ? phaseMap.get(item.phase_id) : undefined}
                  isSelected={selectedItemId === item.id}
                  isExpanded={expandedItemId === item.id}
                  onClick={() => {
                    onSelectItem(item.id);
                    setExpandedItemId(prev => prev === item.id ? null : item.id);
                  }}
                  onRetry={onRetryItem ? () => onRetryItem(item.id) : undefined}
                  onSkip={onSkipItem ? () => onSkipItem(item.id) : undefined}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* PRD Dialog */}
      <Dialog open={showPrd} onOpenChange={(open) => { if (!open) setShowPrd(false); }}>
        {prd && (
          <DialogContent className="!max-w-[90vw] !w-[90vw] !max-h-[90vh] !flex !flex-col overflow-hidden">
            <DialogHeader className="shrink-0">
              <div className="flex items-center gap-3">
                <FileText className="size-5 shrink-0 text-[var(--drac-purple)]" />
                <DialogTitle className="text-lg">Product Requirements Document</DialogTitle>
              </div>
              <DialogDescription className="sr-only">
                Full product requirements document
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="flex-1 min-h-0 mt-4 overflow-auto">
              <Markdown content={prd} />
            </ScrollArea>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Individual row
// ---------------------------------------------------------------------------

interface PhaseInfo {
  prompt?: string | null;
  commit_message?: string | null;
  implementation_notes?: string | null;
  deviations?: string | null;
  complexity?: number | null;
  status?: string;
}

function QueueItemRow({ item, phase, isSelected, isExpanded, onClick, onRetry, onSkip }: {
  item: QueueItem;
  phase?: PhaseInfo;
  isSelected: boolean;
  isExpanded: boolean;
  onClick: () => void;
  onRetry?: () => void;
  onSkip?: () => void;
}) {
  const config = STATUS_CONFIG[item.status];
  const typeLabel = TYPE_LABELS[item.item_type] ?? item.item_type;
  const title = item.phase_title;
  const isError = item.status === "error";
  const hasExpandContent = phase && (phase.prompt || phase.commit_message || phase.implementation_notes || phase.deviations);

  return (
    <div className="flex flex-col">
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
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-xs font-medium text-muted-foreground">{typeLabel}</span>
            {title && (
              <>
                <span className="text-gray-600">&mdash;</span>
                <span className="min-w-0 truncate text-gray-300">{title}</span>
              </>
            )}
            {!title && <span className="min-w-0 truncate text-gray-300" />}
          </div>
        </div>
        {phase?.complexity != null && (
          <Badge variant="outline" className="shrink-0 text-[9px] px-1 py-0">
            {phase.complexity}
          </Badge>
        )}
        {hasExpandContent && (
          <span className="shrink-0 text-gray-600">
            {isExpanded ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
          </span>
        )}
      </button>

      {/* Error actions */}
      {isError && (onRetry || onSkip) && (
        <div className="flex items-center gap-1 px-2 pb-1">
          {onRetry && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRetry(); }}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-gray-400 hover:bg-gray-700 hover:text-gray-200"
            >
              <RotateCcwIcon className="size-2.5" />
              Retry
            </button>
          )}
          {onSkip && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onSkip(); }}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-gray-400 hover:bg-gray-700 hover:text-gray-200"
            >
              <SkipForwardIcon className="size-2.5" />
              Skip
            </button>
          )}
        </div>
      )}

      {/* Expanded detail */}
      {isExpanded && hasExpandContent && (
        <div className="mx-2 mb-1 rounded-md border border-gray-800/50 bg-gray-900/40 p-2 text-xs">
          {phase.prompt && (
            <div className="max-h-32 overflow-y-auto">
              <Markdown content={phase.prompt} className="text-xs" />
            </div>
          )}
          {phase.commit_message && (
            <div className="mt-1.5 rounded border border-border/30 bg-muted/30 px-2 py-1">
              <span className="text-[10px] text-muted-foreground">Commit: </span>
              <code className="text-[11px] text-[var(--drac-green)]">{phase.commit_message}</code>
            </div>
          )}
          {phase.implementation_notes && (phase.status === "completed" || phase.status === "done") && (
            <div className="mt-1.5 rounded border border-border/30 bg-muted/30 px-2 py-1">
              <p className="text-[10px] text-muted-foreground mb-0.5">Notes</p>
              <Markdown content={phase.implementation_notes} className="text-xs" />
            </div>
          )}
          {phase.deviations && (phase.status === "completed" || phase.status === "done") && (
            <div className="mt-1.5 rounded border border-[var(--drac-orange)]/30 bg-[var(--drac-orange)]/5 px-2 py-1">
              <p className="text-[10px] text-[var(--drac-orange)] mb-0.5">Deviations</p>
              <Markdown content={phase.deviations} className="text-xs" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
