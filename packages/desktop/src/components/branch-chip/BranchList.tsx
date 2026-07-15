/**
 * Shared virtualized branch list primitive.
 *
 * Both the feature header's `BranchPicker` and the command-palette's
 * worktree-reuse step render the same shape: a `<Virtuoso>` of branch rows
 * filtered case-insensitively by a query string. Repos can have hundreds of
 * branches, so virtualization is mandatory (`frontend-performance.md`).
 *
 * Consumers supply the row renderer because the metadata shown per row
 * varies (in-use chip, "remote" badge, "Selected" suffix, pending spinner,
 * etc.). The primitive owns:
 *   - case-insensitive name filtering against `query`,
 *   - the `<Virtuoso>` viewport (fixed-height — Virtuoso requires a
 *     bounded height),
 *   - keyboard nav state via `useBranchListKeyboard`, returned alongside
 *     the rendered list so the caller can wire `onKeyDown` onto whichever
 *     element actually captures focus (auto-focused input vs. popover).
 */
import { useCallback, useMemo, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { Virtuoso } from "react-virtuoso";

import { type BranchInfo } from "@/api/generated";
import { useBranchListKeyboard } from "./useBranchListKeyboard";

function filterBranches(branches: BranchInfo[], query: string): BranchInfo[] {
  if (!query) return branches;
  const needle = query.toLowerCase();
  return branches.filter((b) => b.name.toLowerCase().includes(needle));
}

export interface BranchListRowContext {
  branch: BranchInfo;
  index: number;
  isActive: boolean;
}

interface UseBranchListOptions {
  branches: BranchInfo[];
  query: string;
  onPick: (branch: BranchInfo) => void;
  renderRow: (ctx: BranchListRowContext) => ReactNode;
  /** Pixel height of the scroll viewport. Defaults to 320. */
  height?: CSSProperties["height"];
  /** Rendered when filtering removes every branch. */
  emptyState?: ReactNode;
}

interface UseBranchListResult {
  list: ReactElement;
  /** Wire onto the auto-focused input/popover so Up/Down/Enter drive selection. */
  onKeyDown: (e: React.KeyboardEvent) => void;
  /** Filtered count, useful for parents that need to disable submit when 0. */
  filteredCount: number;
}

/**
 * Build a virtualized, query-filtered branch list bundled with its keyboard
 * handler. The caller renders {@link UseBranchListResult.list} wherever the
 * branch list belongs and attaches {@link UseBranchListResult.onKeyDown} to
 * whichever focused element should drive Up/Down/Enter selection.
 */
export function useBranchList({
  branches,
  query,
  onPick,
  renderRow,
  height = 320,
  emptyState,
}: UseBranchListOptions): UseBranchListResult {
  const filtered = useMemo(() => filterBranches(branches, query), [branches, query]);
  const { activeIndex, virtuosoRef, onKeyDown } = useBranchListKeyboard(filtered, onPick);

  const itemContent = useCallback(
    (index: number) => {
      const branch = filtered[index];
      if (!branch) return null;
      return renderRow({ branch, index, isActive: index === activeIndex });
    },
    [filtered, activeIndex, renderRow],
  );

  const list =
    filtered.length === 0 ? (
      <>{emptyState ?? null}</>
    ) : (
      <Virtuoso
        ref={virtuosoRef}
        style={{ height }}
        totalCount={filtered.length}
        itemContent={itemContent}
      />
    );

  return { list, onKeyDown, filteredCount: filtered.length };
}
