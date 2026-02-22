import { Loader2Icon, CheckCircleIcon, XCircleIcon, StopCircleIcon, SquareIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BackgroundTask } from "../../main/agents/background-tasks";

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

interface BackgroundTasksModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: BackgroundTask[];
  onKillTask?: (taskId: string, kind: "bash" | "agent") => void;
}

function StatusDot({ status }: { status: BackgroundTask["status"] }) {
  if (status === "running") {
    return <Loader2Icon className="size-3 animate-spin text-blue-400 shrink-0" />;
  }
  if (status === "completed") {
    return <CheckCircleIcon className="size-3 text-emerald-500 shrink-0" />;
  }
  if (status === "failed") {
    return <XCircleIcon className="size-3 text-red-500 shrink-0" />;
  }
  return <StopCircleIcon className="size-3 text-muted-foreground shrink-0" />;
}

export function BackgroundTasksModal({
  open,
  onOpenChange,
  tasks,
  onKillTask,
}: BackgroundTasksModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Background Tasks</DialogTitle>
        </DialogHeader>

        {tasks.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No background tasks
          </p>
        ) : (
          <ul className="space-y-2 max-h-80 overflow-y-auto">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="flex items-start gap-2 rounded-md border border-border p-2 text-xs"
              >
                <StatusDot status={task.status} />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded px-1 py-0.5 text-[10px] font-medium",
                        task.kind === "bash"
                          ? "bg-amber-500/10 text-amber-400"
                          : "bg-blue-500/10 text-blue-400",
                      )}
                    >
                      {task.kind === "bash" ? "Bash" : "Agent"}
                    </span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">
                      {task.id.length > 20 ? `…${task.id.slice(-16)}` : task.id}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {relativeTime(task.spawnedAt)}
                    </span>
                  </div>

                  {(task.command ?? task.summary) && (
                    <p className="mt-0.5 truncate text-muted-foreground">
                      {task.command ?? task.summary}
                    </p>
                  )}
                </div>

                {task.status === "running" && onKillTask && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 shrink-0 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-red-400"
                    onClick={() => onKillTask(task.id, task.kind)}
                  >
                    <SquareIcon className="size-2.5" />
                    Stop
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
