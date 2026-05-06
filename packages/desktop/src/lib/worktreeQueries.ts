import { invalidateByUrlPrefix, queryClient } from "@/lib/queryClient";

const WORKTREE_QUERY_PREFIXES = ["/api/git/feature-worktrees", "/api/git/worktrees"] as const;

export function invalidateWorktreeQueries(): void {
  void invalidateByUrlPrefix(queryClient, WORKTREE_QUERY_PREFIXES);
}
