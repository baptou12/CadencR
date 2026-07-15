import { ArrowLeftIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { DiffViewer } from "./DiffViewer";

interface GitRevisionDiffViewProps {
  featureId: number;
  revision: string;
  backLabel: string;
  label: string;
  message: string | undefined;
  onBack: () => void;
  trailingAction?: ReactNode;
}

/** Shared frame for commit-like revisions opened from Git list views. */
export function GitRevisionDiffView({
  featureId,
  revision,
  backLabel,
  label,
  message,
  onBack,
  trailingAction,
}: GitRevisionDiffViewProps): ReactElement {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          {backLabel}
        </button>
        <span className="shrink-0 font-mono text-xs text-primary">{label}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{message}</span>
        {trailingAction}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <DiffViewer featureId={featureId} mode="worktree" commitSha={revision} />
      </div>
    </div>
  );
}
