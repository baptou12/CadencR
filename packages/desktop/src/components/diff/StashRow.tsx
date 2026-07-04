import { memo, type ReactElement } from "react";
import { ArchiveIcon } from "lucide-react";
import { NumStat } from "@/components/NumStat";
import type { StashEntry } from "@/api/generated";
import { formatRelativeDate } from "./DiffFileTreeHelpers";

export const STASH_ROW_HEIGHT = 46;

interface StashRowProps {
  stash: StashEntry;
  /** Open this stash's diff (the shared `commit_sha` diff path). */
  onOpen: (stash: StashEntry) => void;
}

/**
 * One row in the Git-tab Stashes list: reflog selector + description, then the
 * creation date, file count and numstat. Mounted in a virtualized list next to
 * the streaming agent area, so it must stay cheap and stable — `memo` plus a
 * stable `onOpen` callback keep it inert during pushes.
 */
export const StashRow = memo(function StashRow({ stash, onOpen }: StashRowProps): ReactElement {
  return (
    <button
      type="button"
      onClick={() => onOpen(stash)}
      style={{ height: STASH_ROW_HEIGHT }}
      className="flex w-full items-center gap-2 px-3 text-left transition-colors hover:bg-accent/60"
    >
      <ArchiveIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 font-mono text-xs text-primary">{stash.ref_name}</span>
          <span className="min-w-0 truncate text-xs text-foreground">{stash.message}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="shrink-0">{formatRelativeDate(stash.date)}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">
            {stash.files_changed} {stash.files_changed === 1 ? "file" : "files"}
          </span>
          <NumStat
            additions={stash.additions}
            deletions={stash.deletions}
            className="shrink-0 text-[10px]"
          />
        </div>
      </div>
    </button>
  );
});
