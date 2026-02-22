import { useState } from "react";
import { trpc } from "@/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, GitBranch, Loader2 } from "lucide-react";

const statusColors: Record<string, string> = {
  planning: "bg-blue-500/15 text-blue-600",
  "in-progress": "bg-yellow-500/15 text-yellow-600",
  review: "bg-purple-500/15 text-purple-600",
  done: "bg-green-500/15 text-green-600",
  blocked: "bg-red-500/15 text-red-600",
};

export function WorktreeList({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const { data: worktrees, isLoading } =
    trpc.git.listProjectWorktrees.useQuery({ projectId });

  const deleteWorktree = trpc.git.deleteWorktree.useMutation({
    onSuccess: () => {
      void utils.git.listProjectWorktrees.invalidate({ projectId });
    },
  });

  const removeOrphan = trpc.git.removeOrphanWorktree.useMutation({
    onSuccess: () => {
      void utils.git.listProjectWorktrees.invalidate({ projectId });
    },
  });

  const [confirmPath, setConfirmPath] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
        Loading worktrees…
      </div>
    );
  }

  if (!worktrees?.length) {
    return (
      <p className="py-3 text-center text-xs text-muted-foreground">
        No worktrees
      </p>
    );
  }

  function handleDelete(wt: NonNullable<typeof worktrees>[number]) {
    if (confirmPath !== wt.path) {
      setConfirmPath(wt.path);
      return;
    }
    setConfirmPath(null);
    if (wt.featureId) {
      deleteWorktree.mutate({ projectId, featureId: wt.featureId });
    } else {
      removeOrphan.mutate({ projectId, worktreePath: wt.path });
    }
  }

  return (
    <div className="max-h-[240px] space-y-1 overflow-y-auto pr-1">
      {worktrees.map((wt) => (
        <div
          key={wt.path}
          className="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
        >
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{wt.branch}</div>
            <div className="truncate text-[11px] font-mono text-muted-foreground/70">
              {wt.path}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {wt.featureTitle ? (
                <span className="flex items-center gap-1.5">
                  {wt.featureTitle}
                  {wt.featureStatus && (
                    <Badge
                      variant="outline"
                      className={`px-1 py-0 text-[10px] leading-tight ${statusColors[wt.featureStatus] ?? ""}`}
                    >
                      {wt.featureStatus}
                    </Badge>
                  )}
                </span>
              ) : (
                <span className="italic">No linked feature</span>
              )}
            </div>
          </div>
          <Button
            variant={confirmPath === wt.path ? "destructive" : "ghost"}
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => handleDelete(wt)}
            disabled={deleteWorktree.isLoading || removeOrphan.isLoading}
            title={
              confirmPath === wt.path ? "Click again to confirm" : "Remove worktree"
            }
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}
