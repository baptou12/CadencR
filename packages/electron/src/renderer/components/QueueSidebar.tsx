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
  const [expandedPhase, setExpandedPhase] = useState<PhaseInfo | null>(null);
  const [showPrd, setShowPrd] = useState(false);

  const { data: plan } = useGetFeaturePlan(featureId ?? 0, { enabled: featureId != null && featureId > 0 });
  const { data: prdData } = useGetFeaturePrd(featureId ?? 0, { enabled: featureId != null && featureId > 0 });
  const prd = prdData?.prd;

  // Build a map from phase_id to phase data for quick lookup
  const phaseMap = useMemo(() => {
    if (!plan?.phases) return new Map<number, PhaseInfo>();
    const m = new Map<number, PhaseInfo>();
    for (const p of plan.phases) {
      m.set(p.id, {
        step_number: p.step_number,
        title: p.title,
        prompt: p.prompt,
        commit_message: p.commit_message,
        implementation_notes: p.implementation_notes,
        deviations: p.deviations,
        complexity: typeof p.complexity === "number" ? p.complexity : null,
        status: p.status ?? undefined,
      });
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
      <div className={cn("flex h-full w-80 shrink-0 flex-col overflow-y-auto", className)}>
        {/* Plan header */}
        {plan && (
          <div className="border-b border-gray-800 px-3 py-2.5">
            <h3 className="truncate text-sm font-semibold text-foreground">{plan.title}</h3>
            {plan.summary && (
              <p className="mt-0.5 text-xs text-muted-foreground">{plan.summary}</p>
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
              <div className="px-2 pt-2 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                Step {(group.groupIndex ?? gi) + 1}
              </div>
              {group.items.map(item => {
                const phase = item.phase_id != null ? phaseMap.get(item.phase_id) : undefined;
                return (
                  <QueueItemRow
                    key={item.id}
                    item={item}
                    phase={phase}
                    isSelected={selectedItemId === item.id}
                    onClick={() => {
                      onSelectItem(item.id);
                      if (phase) setExpandedPhase(phase);
                    }}
                    onRetry={onRetryItem ? () => onRetryItem(item.id) : undefined}
                    onSkip={onSkipItem ? () => onSkipItem(item.id) : undefined}
                  />
                );
              })}
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

      {/* Phase Detail Dialog */}
      <Dialog open={expandedPhase !== null} onOpenChange={(open) => { if (!open) setExpandedPhase(null); }}>
        {expandedPhase && (
          <DialogContent className="!max-w-[90vw] !w-[90vw] !max-h-[90vh] !flex !flex-col overflow-hidden">
            <DialogHeader className="shrink-0">
              <div className="flex items-center gap-3">
                <DialogTitle className="text-lg">
                  {expandedPhase.step_number != null && `Phase ${expandedPhase.step_number}: `}{expandedPhase.title}
                </DialogTitle>
              </div>
              <DialogDescription className="sr-only">
                Phase details
              </DialogDescription>
              <div className="flex items-center gap-2 mt-1">
                {expandedPhase.status && (
                  <Badge variant="secondary">{expandedPhase.status}</Badge>
                )}
                {expandedPhase.complexity != null && (
                  <Badge variant="outline">Complexity: {expandedPhase.complexity}</Badge>
                )}
              </div>
            </DialogHeader>
            <ScrollArea className="flex-1 min-h-0 mt-4 overflow-auto">
              {expandedPhase.prompt && (
                <Markdown content={expandedPhase.prompt} />
              )}
              {expandedPhase.commit_message && (
                <div className="mt-4 rounded-md border border-border bg-muted/50 p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Commit message</p>
                  <code className="text-sm text-[var(--drac-green)]">{expandedPhase.commit_message}</code>
                </div>
              )}
              {expandedPhase.implementation_notes && (expandedPhase.status === "completed" || expandedPhase.status === "done") && (
                <div className="mt-4 rounded-md border border-border bg-muted/50 p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Implementation Notes</p>
                  <Markdown content={expandedPhase.implementation_notes} className="text-sm" />
                </div>
              )}
              {expandedPhase.deviations && (expandedPhase.status === "completed" || expandedPhase.status === "done") && (
                <div className="mt-4 rounded-md border border-[var(--drac-orange)]/40 bg-[var(--drac-orange)]/10 p-3">
                  <p className="text-xs font-medium text-[var(--drac-orange)] mb-1">Deviations</p>
                  <Markdown content={expandedPhase.deviations} className="text-sm" />
                </div>
              )}
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
  step_number?: number;
  title?: string | null;
  prompt?: string | null;
  commit_message?: string | null;
  implementation_notes?: string | null;
  deviations?: string | null;
  complexity?: number | null;
  status?: string;
}

function QueueItemRow({ item, phase, isSelected, onClick, onRetry, onSkip }: {
  item: QueueItem;
  phase?: PhaseInfo;
  isSelected: boolean;
  onClick: () => void;
  onRetry?: () => void;
  onSkip?: () => void;
}) {
  const config = STATUS_CONFIG[item.status];
  const typeLabel = TYPE_LABELS[item.item_type] ?? item.item_type;
  const title = phase?.title ?? item.phase_title;
  const isError = item.status === "error";

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
            {title ? (
              <span className="min-w-0 truncate text-xs font-medium text-gray-300">{title}</span>
            ) : (
              <span className="shrink-0 text-xs font-medium text-muted-foreground">{typeLabel}</span>
            )}
          </div>
        </div>
        {phase?.complexity != null && (
          <Badge variant="outline" className="shrink-0 text-[9px] px-1 py-0">
            {phase.complexity}
          </Badge>
        )}
        {(item.retry_count ?? 0) > 0 && (
          <Badge variant="outline" className="shrink-0 text-[9px] px-1 py-0 border-yellow-600 text-yellow-400">
            Retrying ({item.retry_count}/{item.max_retries ?? 1})
          </Badge>
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

    </div>
  );
}
