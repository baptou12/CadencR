import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, GitBranch, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProjectWorktrees,
  useDeleteWorktree,
  useRemoveOrphanWorktree,
  getListProjectWorktreesQueryKey,
} from "@/api/generated";

const statusColors: Record<string, string> = {
  planning: "bg-blue-500/15 text-blue-600",
  "in-progress": "bg-yellow-500/15 text-yellow-600",
  review: "bg-purple-500/15 text-purple-600",
  done: "bg-green-500/15 text-green-600",
  blocked: "bg-red-500/15 text-red-600",
};

export function WorktreeList({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const { data: worktrees, isLoading } = useListProjectWorktrees({ project_id: projectId });

  const deleteWorktree = useDeleteWorktree({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getListProjectWorktreesQueryKey({ project_id: projectId }),
        });
      },
    },
  });

  const removeOrphan = useRemoveOrphanWorktree({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getListProjectWorktreesQueryKey({ project_id: projectId }),
        });
      },
    },
  });

  const [confirmPath, setConfirmPath] = useState<string | null>(null);
  const [deletingPaths, setDeletingPaths] = useState<Set<string>>(new Set());

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
        Loading worktrees…
      </div>
    );
  }

  if (!worktrees?.length) {
    return <p className="py-3 text-center text-xs text-muted-foreground">No worktrees</p>;
  }

  function handleDelete(wt: NonNullable<typeof worktrees>[number]) {
    if (confirmPath !== wt.path) {
      setConfirmPath(wt.path);
      return;
    }
    setConfirmPath(null);
    setDeletingPaths((prev) => new Set(prev).add(wt.path));
    const onSettled = () =>
      setDeletingPaths((prev) => {
        const next = new Set(prev);
        next.delete(wt.path);
        return next;
      });
    if (wt.feature_id) {
      deleteWorktree.mutate(
        { params: { project_id: projectId, feature_id: wt.feature_id } },
        { onSettled },
      );
    } else {
      removeOrphan.mutate(
        { data: { project_id: projectId, worktree_path: wt.path } },
        { onSettled },
      );
    }
  }

  return (
    <div className="max-h-[240px] space-y-1 overflow-y-auto pr-1">
      {worktrees.map((wt) => (
        <div key={wt.path} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{wt.branch}</div>
            <div className="truncate text-[11px] font-mono text-muted-foreground/70">{wt.path}</div>
            <div className="truncate text-xs text-muted-foreground">
              {wt.feature_title ? (
                <span className="flex items-center gap-1.5">
                  {wt.feature_title}
                  {wt.feature_status && (
                    <Badge
                      variant="outline"
                      className={`px-1 py-0 text-[10px] leading-tight ${statusColors[wt.feature_status] ?? ""}`}
                    >
                      {wt.feature_status}
                    </Badge>
                  )}
                </span>
              ) : (
                <span className="italic">No linked feature</span>
              )}
            </div>
          </div>
          {deletingPaths.has(wt.path) ? (
            <div className="flex h-6 w-6 shrink-0 items-center justify-center">
              <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            </div>
          ) : (
            <Button
              variant={confirmPath === wt.path ? "destructive" : "ghost"}
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() => handleDelete(wt)}
              title={confirmPath === wt.path ? "Click again to confirm" : "Remove worktree"}
            >
              <Trash2 className="size-3" />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
