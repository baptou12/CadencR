/**
 * Grouped checkbox list of uncommitted files for `CommitDialog`. Displays one
 * group per status bucket (Staged / Unstaged / Untracked) with a small
 * staged-bookmark icon next to staged files. The dialog owns the selection
 * `Set`; this component is a controlled view.
 */
import { memo, type ReactElement } from "react";
import { BookmarkCheck } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { NumStat } from "@/components/diff/NumStat";
import type { UncommittedFile } from "@/api/generated";
import { cn } from "@/lib/utils";

type Bucket = "staged" | "unstaged" | "untracked";

interface Group {
  key: Bucket;
  label: string;
  files: UncommittedFile[];
}

function bucketize(files: UncommittedFile[]): Group[] {
  const staged: UncommittedFile[] = [];
  const unstaged: UncommittedFile[] = [];
  const untracked: UncommittedFile[] = [];
  for (const f of files) {
    if (f.status === "staged" || f.status === "both") staged.push(f);
    if (f.status === "unstaged" || f.status === "both") unstaged.push(f);
    if (f.status === "untracked") untracked.push(f);
  }
  const all: Group[] = [
    { key: "staged", label: "Staged", files: staged },
    { key: "unstaged", label: "Unstaged", files: unstaged },
    { key: "untracked", label: "Untracked", files: untracked },
  ];
  return all.filter((g) => g.files.length > 0);
}

interface UncommittedFileListProps {
  files: UncommittedFile[];
  selected: Set<string>;
  onToggle: (path: string) => void;
}

export const UncommittedFileList = memo(function UncommittedFileList({
  files,
  selected,
  onToggle,
}: UncommittedFileListProps): ReactElement {
  const groups = bucketize(files);
  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">No uncommitted files.</p>;
  }
  return (
    // `pr-3` reserves a gutter for the overlay scrollbar so it doesn't
    // sit on top of the per-row `<NumStat>` badges. `pr-1` (the previous
    // value) was narrower than the macOS scrollbar in practice.
    <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-3">
      {groups.map((group) => (
        <div key={group.key}>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
            {group.key === "staged" && <BookmarkCheck className="size-3" />}
            <span>
              {group.label} ({group.files.length})
            </span>
          </div>
          <ul className="space-y-1">
            {group.files.map((file) => {
              const id = `commit-file-${group.key}-${file.path}`;
              return (
                <li key={id} className="flex items-center gap-2 min-w-0">
                  <Checkbox
                    id={id}
                    checked={selected.has(file.path)}
                    onCheckedChange={() => onToggle(file.path)}
                  />
                  <label
                    htmlFor={id}
                    className={cn(
                      // `min-w-0` is mandatory: a flex item defaults to
                      // `min-width: auto`, which prevents `truncate` from
                      // ever shrinking the label below its intrinsic text
                      // width. Without it, long paths force the row wider
                      // than the dialog and spill out horizontally.
                      "flex-1 min-w-0 truncate text-sm cursor-pointer font-mono",
                      file.change_kind === "deleted" && "line-through text-muted-foreground",
                    )}
                    title={file.path}
                  >
                    <span className="text-muted-foreground mr-2 uppercase text-xs">
                      {file.change_kind.charAt(0)}
                    </span>
                    {file.path}
                  </label>
                  {/* `hideZero` (default) suppresses untracked-file 0/0
                      rows. The shrink-0 keeps the badge from being
                      compressed when the path label is long. */}
                  <NumStat
                    additions={file.additions}
                    deletions={file.deletions}
                    className="shrink-0 text-xs"
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
});
