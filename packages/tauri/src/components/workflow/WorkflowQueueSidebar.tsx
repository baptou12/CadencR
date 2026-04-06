/**
 * WorkflowQueueSidebar — vertical phase pipeline for custom workflow features.
 * Shows phase cards with gate status, dependency connectors, and action buttons.
 */

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  CheckCircle2Icon,
  CircleIcon,
  LockIcon,
  PlayIcon,
  Loader2Icon,
  XCircleIcon,
  ZapIcon,
  ShieldIcon,
  PointerIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  CpuIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useGetWorkflowDefinition } from "@/api/generated";
import { useWorkflowStore } from "@/hooks/useWorkflowWebSocket";
import type { PhaseStatus, QueueItem } from "@/types/workflow";
import type { WorkflowPhase } from "@/api/generated";

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<PhaseStatus, { icon: React.ReactNode; className: string; label: string }> = {
  pending: { icon: <CircleIcon className="size-3.5" />, className: "text-gray-500", label: "Pending" },
  blocked: { icon: <LockIcon className="size-3.5" />, className: "text-gray-600", label: "Blocked" },
  ready: { icon: <PlayIcon className="size-3.5" />, className: "text-yellow-400", label: "Ready" },
  running: { icon: <Loader2Icon className="size-3.5 animate-spin" />, className: "text-blue-400", label: "Running" },
  completed: { icon: <CheckCircle2Icon className="size-3.5" />, className: "text-green-400", label: "Completed" },
  pending_approval: { icon: <ShieldAlertIcon className="size-3.5" />, className: "text-orange-400", label: "Pending Approval" },
  error: { icon: <XCircleIcon className="size-3.5" />, className: "text-red-400", label: "Error" },
};

const GATE_CONFIG: Record<string, { icon: React.ReactNode; label: string }> = {
  auto: { icon: <ZapIcon className="size-3" />, label: "Auto" },
  approval: { icon: <ShieldIcon className="size-3" />, label: "Approval" },
  manual: { icon: <PointerIcon className="size-3" />, label: "Manual" },
  iterate: { icon: <RotateCcwIcon className="size-3" />, label: "Iterate" },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface WorkflowQueueSidebarProps {
  workflowDefinitionId: number;
  onViewArtifact?: (phaseSlug: string, artifactTypes?: string[]) => void;
  onScrollToAgent?: (sessionId: number) => void;
  className?: string;
}

export function WorkflowQueueSidebar({
  workflowDefinitionId,
  onViewArtifact,
  onScrollToAgent,
  className,
}: WorkflowQueueSidebarProps) {
  const { data: definition, isLoading } = useGetWorkflowDefinition(workflowDefinitionId);
  const phaseStates = useWorkflowStore((s) => s.phaseStates);
  const queue = useWorkflowStore((s) => s.queue);
  const approvePhase = useWorkflowStore((s) => s.approvePhase);
  const triggerPhase = useWorkflowStore((s) => s.triggerPhase);

  const sortedPhases = useMemo(
    () => definition?.phases ? [...definition.phases].sort((a, b) => a.order_index - b.order_index) : [],
    [definition?.phases],
  );

  // Detect decomposed task items in the queue (item_type contains ":")
  const decomposedTasks = useMemo(() => {
    const grouped = new Map<string, typeof queue>();
    for (const item of queue) {
      if (item.item_type.includes(":")) {
        const parentSlug = item.item_type.split(":")[0];
        if (!grouped.has(parentSlug)) grouped.set(parentSlug, []);
        grouped.get(parentSlug)!.push(item);
      }
    }
    // Sort sub-tasks by order_index within each group
    for (const tasks of grouped.values()) {
      tasks.sort((a, b) => a.order_index - b.order_index);
    }
    return grouped;
  }, [queue]);

  // Build dependency map for connector rendering
  const hasMultipleInputs = useMemo(() => {
    const set = new Set<string>();
    for (const phase of sortedPhases) {
      if (phase.input_phase_slugs.length > 1) set.add(phase.slug);
    }
    return set;
  }, [sortedPhases]);

  // Map phase slugs to queue items for iteration state
  const queueBySlug = useMemo(() => {
    const map = new Map<string, (typeof queue)[number]>();
    for (const item of queue) {
      if (!item.item_type.includes(":")) map.set(item.item_type, item);
    }
    return map;
  }, [queue]);

  if (isLoading) {
    return (
      <div className={cn("flex h-full w-72 shrink-0 items-center justify-center", className)}>
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!definition) return null;

  const completedCount = sortedPhases.filter(
    (p) => phaseStates.get(p.slug)?.status === "completed",
  ).length;

  return (
    <div className={cn("flex h-full w-72 shrink-0 flex-col overflow-hidden", className)}>
      {/* Header */}
      <div className="border-b border-gray-800 px-3 py-2.5">
        <h3 className="truncate text-sm font-semibold text-foreground">{definition.name}</h3>
        {sortedPhases.length > 0 && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-green-500 transition-all duration-300"
                style={{ width: `${(completedCount / sortedPhases.length) * 100}%` }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
              {completedCount}/{sortedPhases.length}
            </span>
          </div>
        )}
      </div>

      {/* Phase pipeline */}
      <div className="flex-1 overflow-y-auto p-2">
        {sortedPhases.map((phase, index) => {
          const tasks = decomposedTasks.get(phase.slug);
          const isDecomposed = tasks && tasks.length > 0;

          return (
            <div key={phase.slug}>
              <PhaseCard
                phase={phase}
                item={queueBySlug.get(phase.slug)}
                status={phaseStates.get(phase.slug)?.status ?? "pending"}
                artifactPreview={phaseStates.get(phase.slug)?.artifactPreview ?? null}
                agentSessionId={phaseStates.get(phase.slug)?.agentSessionId ?? null}
                isLast={!isDecomposed && index === sortedPhases.length - 1}
                hasMultipleInputs={hasMultipleInputs.has(phase.slug)}
                onTrigger={() => triggerPhase(phase.slug)}
                onViewArtifact={onViewArtifact ? () => onViewArtifact(phase.slug, phase.artifact_types?.length ? phase.artifact_types : undefined) : undefined}
                onScrollToAgent={onScrollToAgent}
              />
              {isDecomposed && tasks.map((task, taskIdx) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  isLast={taskIdx === tasks.length - 1 && index === sortedPhases.length - 1}
                  onScrollToAgent={onScrollToAgent}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase card
// ---------------------------------------------------------------------------

interface PhaseCardProps {
  phase: WorkflowPhase;
  item?: QueueItem;
  status: PhaseStatus;
  artifactPreview: string | null;
  agentSessionId: number | null;
  isLast: boolean;
  hasMultipleInputs: boolean;
  onTrigger: () => void;
  onViewArtifact?: () => void;
  onScrollToAgent?: (sessionId: number) => void;
}

function PhaseCard({
  phase,
  item,
  status,
  artifactPreview,
  agentSessionId,
  isLast,
  hasMultipleInputs,
  onTrigger,
  onViewArtifact,
  onScrollToAgent,
}: PhaseCardProps) {
  const config = STATUS_CONFIG[status];
  const gate = GATE_CONFIG[phase.gate_type];

  return (
    <div className="relative flex">
      {/* Connector line */}
      <div className="flex w-6 shrink-0 flex-col items-center">
        <div className={cn("size-5 rounded-full border-2 flex items-center justify-center", statusBorderColor(status))}>
          <span className={config.className}>{config.icon}</span>
        </div>
        {!isLast && (
          <div className={cn(
            "w-0.5 flex-1 min-h-3",
            hasMultipleInputs ? "border-l-2 border-dashed border-gray-700" : "bg-gray-700",
          )} />
        )}
      </div>

      {/* Card body */}
      <div className="flex-1 min-w-0 pb-2 pl-2">
        <button
          type="button"
          onClick={() => {
            if ((status === "completed" || status === "pending_approval") && onViewArtifact) onViewArtifact();
          }}
          className={cn(
            "w-full rounded-md border border-gray-800 px-2.5 py-2 text-left transition-colors",
            "hover:bg-gray-800/40",
            status === "running" && "border-blue-500/40 bg-blue-500/5",
            status === "error" && "border-red-500/40",
            (status === "completed" || status === "pending_approval") && onViewArtifact && "cursor-pointer",
          )}
        >
          {/* Name + badges row */}
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-xs font-medium text-gray-200">{phase.name}</span>
            {gate && (
              <Badge variant="outline" className="shrink-0 gap-0.5 px-1 py-0 text-[9px]">
                {gate.icon} {gate.label}
              </Badge>
            )}
            {(item?.iteration_count ?? 0) > 0 && (
              <Badge variant="outline" className="shrink-0 gap-0.5 px-1 py-0 text-[9px] text-green-400 border-green-500/40">
                Iter {item?.iteration_count}/{phase.max_iterations}
              </Badge>
            )}
            {phase.model_override && (
              <Badge variant="outline" className="shrink-0 gap-0.5 px-1 py-0 text-[9px]">
                <CpuIcon className="size-2.5" /> {phase.model_override}
              </Badge>
            )}
          </div>

          {/* Running: link to agent */}
          {status === "running" && agentSessionId != null && onScrollToAgent && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onScrollToAgent(agentSessionId); }}
              className="mt-1 text-[10px] text-blue-400 hover:underline"
            >
              View agent output →
            </button>
          )}

          {/* Completed: artifact preview */}
          {status === "completed" && artifactPreview && (
            <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground font-mono">
              {artifactPreview}
            </p>
          )}
        </button>

        {/* Action buttons */}
        {status === "ready" && phase.gate_type === "manual" && (
          <Button size="sm" variant="outline" className="mt-1 h-6 text-[10px] gap-1" onClick={onTrigger}>
            <PlayIcon className="size-3" /> Start Phase
          </Button>
        )}
        {status === "error" && (
          <Button size="sm" variant="outline" className="mt-1 h-6 text-[10px] gap-1 text-red-400" onClick={onTrigger}>
            <RotateCcwIcon className="size-3" /> Retry
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task card (decomposed sub-item)
// ---------------------------------------------------------------------------

interface TaskCardProps {
  task: QueueItem;
  isLast: boolean;
  onScrollToAgent?: (sessionId: number) => void;
}

function TaskCard({ task, isLast, onScrollToAgent }: TaskCardProps) {
  const status = task.status as PhaseStatus;
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;

  // Parse task title from config JSON or phase_title
  let taskTitle = task.phase_title ?? task.item_type;
  if (!task.phase_title) {
    // item_type is "implement:001" — show the index
    const parts = task.item_type.split(":");
    taskTitle = `Task ${Number.parseInt(parts[1] ?? "0", 10) + 1}`;
  }

  return (
    <div className="relative flex">
      {/* Indented connector */}
      <div className="flex w-6 shrink-0 flex-col items-center pl-2">
        <div className={cn("size-3.5 rounded-full border flex items-center justify-center", statusBorderColor(status))}>
          <span className={cn(config.className, "scale-75")}>{config.icon}</span>
        </div>
        {!isLast && <div className="w-0.5 flex-1 min-h-2 bg-gray-700/50" />}
      </div>

      {/* Card */}
      <div className="flex-1 min-w-0 pb-1.5 pl-1.5">
        <div className={cn(
          "rounded border border-gray-800/60 px-2 py-1.5 text-left",
          status === "running" && "border-blue-500/30 bg-blue-500/5",
          status === "error" && "border-red-500/30",
        )}>
          <div className="flex items-center gap-1">
            <span className="min-w-0 truncate text-[10px] font-medium text-gray-300">{taskTitle}</span>
          </div>
          {status === "running" && task.agent_session_id != null && onScrollToAgent && (
            <button
              type="button"
              onClick={() => onScrollToAgent(task.agent_session_id!)}
              className="mt-0.5 text-[9px] text-blue-400 hover:underline"
            >
              View output →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function statusBorderColor(status: PhaseStatus): string {
  switch (status) {
    case "completed": return "border-green-500";
    case "running": return "border-blue-500";
    case "error": return "border-red-500";
    case "pending_approval": return "border-orange-500";
    case "ready": return "border-yellow-500";
    case "blocked": return "border-gray-600";
    default: return "border-gray-700";
  }
}
