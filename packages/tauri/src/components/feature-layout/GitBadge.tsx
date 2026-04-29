import type { ReactElement } from "react";

interface GitBadgeProps {
  gitStats: { insertions: number; deletions: number } | null | undefined;
  gitBranch: string | null | undefined;
}

export function GitBadge({ gitStats, gitBranch }: GitBadgeProps): ReactElement {
  return (
    <>
      {gitBranch && <span className="truncate max-w-[120px]">{gitBranch}</span>}
      {gitStats && gitStats.insertions > 0 && (
        <span className="text-green-500">+{gitStats.insertions}</span>
      )}
      {gitStats && gitStats.deletions > 0 && (
        <span className="text-red-400">-{gitStats.deletions}</span>
      )}
    </>
  );
}
