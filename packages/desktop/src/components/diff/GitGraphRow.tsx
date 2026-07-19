import { memo, useMemo, type ReactElement } from "react";
import { FileDiffIcon, ExternalLinkIcon } from "lucide-react";
import { NumStat } from "@/components/NumStat";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ContextMenuActionItem } from "@/components/ContextMenuActionItem";
import type { GraphRow } from "@/lib/git-graph-layout";
import { SlidingText } from "@/components/SlidingText";
import { cn } from "@/lib/utils";
import { CommitItemHoverCard, formatRelativeDate, type CommitEntry } from "./DiffFileTreeHelpers";

export const ROW_HEIGHT = 46;
const COL_WIDTH = 14;
const LEFT_PAD = 6;
const DOT_R = 4.5;
const LANE_COUNT = 5; // matches --chart-1..--chart-5

function laneColor(col: number): string {
  return `var(--chart-${(col % LANE_COUNT) + 1})`;
}

function colX(col: number): number {
  return LEFT_PAD + col * COL_WIDTH + COL_WIDTH / 2;
}

interface Segment {
  key: string;
  d: string;
  color: string;
}

/** Build the SVG path segments (pass-through lanes + merge/branch curves). */
function buildSegments(row: GraphRow): Segment[] {
  const mid = ROW_HEIGHT / 2;
  const { commitCol, lanesBefore, lanesAfter, mergeInCols, parentCols } = row;
  const segs: Segment[] = [];
  const nodeX = colX(commitCol);

  for (let c = 0; c < lanesBefore.length; c++) {
    if (lanesBefore[c] == null) continue;
    const x = colX(c);
    if (mergeInCols.includes(c) && c !== commitCol) {
      // Child lane bending down into the node.
      segs.push({
        key: `t-${c}`,
        color: laneColor(c),
        d: `M ${x} 0 Q ${x} ${mid} ${nodeX} ${mid}`,
      });
    } else {
      segs.push({ key: `t-${c}`, color: laneColor(c), d: `M ${x} 0 L ${x} ${mid}` });
    }
  }

  for (let c = 0; c < lanesAfter.length; c++) {
    if (lanesAfter[c] == null) continue;
    const x = colX(c);
    if (parentCols.includes(c) && c !== commitCol) {
      // New parent lane leaving the node.
      segs.push({
        key: `b-${c}`,
        color: laneColor(c),
        d: `M ${nodeX} ${mid} Q ${x} ${mid} ${x} ${ROW_HEIGHT}`,
      });
    } else {
      segs.push({ key: `b-${c}`, color: laneColor(c), d: `M ${x} ${mid} L ${x} ${ROW_HEIGHT}` });
    }
  }
  return segs;
}

const GraphCell = memo(function GraphCell({
  row,
  columns,
  isPushed,
}: {
  row: GraphRow;
  columns: number;
  isPushed: boolean;
}): ReactElement {
  const segments = useMemo(() => buildSegments(row), [row]);
  const width = LEFT_PAD * 2 + columns * COL_WIDTH;
  const nodeX = colX(row.commitCol);
  const nodeColor = laneColor(row.commitCol);
  return (
    <svg
      width={width}
      height={ROW_HEIGHT}
      className="shrink-0"
      style={{ minWidth: width }}
      aria-hidden
    >
      {segments.map((s) => (
        <path key={s.key} d={s.d} stroke={s.color} strokeWidth={1.5} fill="none" />
      ))}
      <circle
        cx={nodeX}
        cy={ROW_HEIGHT / 2}
        r={DOT_R}
        // Pushed commits are filled; unpushed (local-only) are hollow — the
        // common git-graph convention, so we don't overload the lane color.
        fill={isPushed ? nodeColor : "var(--background)"}
        stroke={nodeColor}
        strokeWidth={1.5}
      />
    </svg>
  );
});

export interface GitGraphRowData extends CommitEntry {
  parents: string[];
  refs: string[];
  filesChanged: number;
  additions: number;
  deletions: number;
}

interface GitGraphRowProps {
  commit: GitGraphRowData;
  row: GraphRow;
  columns: number;
  /** Open this commit's full diff (left-click or "Show diff"). */
  onOpenCommit: (sha: string) => void;
  /** Open this commit on the remote host (GitHub/GitLab/…). */
  onOpenOnline: (sha: string) => void;
  active?: boolean;
}

export const GitGraphRow = memo(function GitGraphRow({
  commit,
  row,
  columns,
  onOpenCommit,
  onOpenOnline,
  active = false,
}: GitGraphRowProps): ReactElement {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {/* Wrapper div is the right-click target; the hover card + button live
            inside so left-click, hover, and context menu don't fight over the
            same `asChild` slot. */}
        <div className="w-full">
          <CommitItemHoverCard commit={commit}>
            <button
              type="button"
              onClick={() => onOpenCommit(commit.sha)}
              aria-current={active ? "true" : undefined}
              style={{ height: ROW_HEIGHT }}
              className={cn(
                "flex w-full items-center gap-2 px-2 text-left transition-colors hover:bg-accent/60",
                active && "bg-accent/70 ring-1 ring-inset ring-primary",
              )}
            >
              <GraphCell row={row} columns={columns} isPushed={commit.isPushed} />
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 font-mono text-xs text-primary">{commit.shortSha}</span>
                  {commit.refs.map((r) => (
                    <span
                      key={r}
                      className="shrink-0 truncate rounded border border-border bg-secondary px-1 py-px font-mono text-[10px] text-secondary-foreground"
                    >
                      {r}
                    </span>
                  ))}
                  <SlidingText
                    text={commit.message}
                    className="min-w-0 flex-1 text-xs text-foreground"
                  />
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span className="truncate">{commit.author}</span>
                  <span aria-hidden>·</span>
                  <span className="shrink-0">{formatRelativeDate(commit.date)}</span>
                  <span aria-hidden>·</span>
                  <span className="shrink-0">
                    {commit.filesChanged} {commit.filesChanged === 1 ? "file" : "files"}
                  </span>
                  <NumStat
                    additions={commit.additions}
                    deletions={commit.deletions}
                    className="shrink-0 text-[10px]"
                  />
                </div>
              </div>
            </button>
          </CommitItemHoverCard>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuActionItem icon={FileDiffIcon} onSelect={() => onOpenCommit(commit.sha)}>
          Show diff
        </ContextMenuActionItem>
        <ContextMenuActionItem icon={ExternalLinkIcon} onSelect={() => onOpenOnline(commit.sha)}>
          Open commit online
        </ContextMenuActionItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
