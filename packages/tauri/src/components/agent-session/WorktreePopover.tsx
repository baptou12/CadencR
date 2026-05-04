/**
 * Pre-first-prompt button group for the worktree behavior. Two chips that
 * compose every case the user asked for ("define a base branch, decide if I
 * want a worktree, or work on an existing branch — moving to its worktree
 * if it already has one"):
 *
 *   • Branch chip   — picks the branch. Defaults to the project's current
 *                     branch (passed in as `defaultBranch`). The chevron
 *                     opens a virtualized, searchable list. `BranchInfo`
 *                     already carries `attached_worktree_path` so we can
 *                     surface "in use by feature #N" inline.
 *
 *   • Worktree chip — boolean toggle. When ON the agent will run in a
 *                     worktree; when OFF it runs in the project directory
 *                     as-is.
 *
 * The resolved `WorktreeChoice` is the parent's responsibility: the route
 * layer combines the two chips, looks up whether the picked branch is
 * already attached, and writes `worktree_mode` / `worktree_base_branch` /
 * `worktree_reuse_branch` settings before the first `prompt.send` envelope
 * goes out. We don't extend the WS protocol — the backend's
 * `ensure_worktree` reads those settings on each call.
 */
import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { CheckIcon, ChevronDownIcon, GitBranchIcon, Loader2 } from "lucide-react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useListBranches, type BranchInfo } from "@/api/generated";
import { useBranchListKeyboard } from "@/components/branch-chip/useBranchListKeyboard";

/**
 * Resolved worktree choice as fed to the route's prompt-send handler. The
 * route resolves it from the `useWorktree` toggle + `selectedBranch` picker
 * (and the `BranchInfo.attached_worktree_path` lookup for reuse detection).
 *
 * - `off`: run agent in the project directory; no worktree action.
 * - `new`: create a fresh branch on a new worktree, optionally forked from
 *   `base`. `base = null` means "use the project's current HEAD" (today's
 *   default behavior).
 * - `reuse`: attach to an existing branch — if it's already checked out in
 *   another worktree the backend shares that worktree, otherwise it spins
 *   up a new worktree on the same branch.
 */
export type WorktreeChoice =
  | { kind: "off" }
  | { kind: "new"; base: string | null }
  | { kind: "reuse"; branch: string };

interface WorktreeButtonGroupProps {
  projectId: number;
  /**
   * The project's currently checked-out branch — used as the picker's
   * "default" hint and as the implicit value when the user hasn't picked
   * anything explicitly. Pass `undefined` when the lookup is still in
   * flight; the picker just won't badge any row as default.
   */
  defaultBranch: string | undefined;
  /** ON/OFF state of the "Use worktree" chip. */
  useWorktree: boolean;
  onToggleWorktree: () => void;
  /**
   * Currently selected branch in the Branch picker, or `null` when the
   * user is implicitly using `defaultBranch`. The route resolves this into
   * a `WorktreeChoice` together with `useWorktree`.
   */
  selectedBranch: string | null;
  onSelectedBranchChange: (next: string | null) => void;
}

// Mirrors `MODEL_GROUP` / `MODEL_SEGMENT` in MetaBar so the two halves
// (Branch picker, Use-worktree toggle) render as a single segmented chip
// with a hairline divider between them — same height, same border, no gap.
// Active "Use worktree" state lights the right segment cyan; an inactive
// pill stays at `text-foreground` for legibility against the chrome.
const GROUP =
  "inline-flex h-8 items-stretch rounded-md border border-border bg-muted/40 text-[11px] font-medium shadow-sm overflow-hidden";
const SEGMENT =
  "inline-flex h-full items-center gap-1.5 px-2.5 transition-colors text-foreground hover:bg-accent";
const SEGMENT_ACTIVE =
  "inline-flex h-full items-center gap-1.5 px-2.5 transition-colors bg-cyan-500/25 text-cyan-300 hover:bg-cyan-500/35";

function filterBranches(branches: BranchInfo[], query: string): BranchInfo[] {
  if (!query) return branches;
  const needle = query.toLowerCase();
  return branches.filter((b) => b.name.toLowerCase().includes(needle));
}

export const WorktreeButtonGroup = memo(function WorktreeButtonGroup({
  projectId,
  defaultBranch,
  useWorktree,
  onToggleWorktree,
  selectedBranch,
  onSelectedBranchChange,
}: WorktreeButtonGroupProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const branchesQuery = useListBranches(
    { project_id: projectId },
    // Repos can have hundreds of branches — only fetch when the user opens
    // the picker. The chip text only needs the name we already track.
    { query: { enabled: open } },
  );
  const filtered = useMemo(
    () => filterBranches(branchesQuery.data ?? [], query),
    [branchesQuery.data, query],
  );

  const handlePick = useCallback(
    (branch: BranchInfo) => {
      onSelectedBranchChange(branch.name);
      setOpen(false);
    },
    [onSelectedBranchChange],
  );
  const { activeIndex, virtuosoRef, onKeyDown } = useBranchListKeyboard(filtered, handlePick);

  // What label shows in the chip when the user hasn't picked anything yet.
  const effectiveBranch = selectedBranch ?? defaultBranch ?? null;
  const branchLabel = effectiveBranch ?? "branch";

  return (
    <div className={GROUP}>
      {/* Branch segment — search/select; default-highlighted = project HEAD.
          Always rendered in the active style: a branch is always selected
          (project default when the user hasn't picked anything), so this
          segment is never in a "no value" state. */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={cn(SEGMENT_ACTIVE, "rounded-l-md")}>
            <GitBranchIcon className="size-3" />
            <span className="truncate max-w-[160px]">{branchLabel}</span>
            <ChevronDownIcon className="size-3 opacity-70" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[28rem] max-w-[calc(100vw-2rem)] p-0" align="start">
          <div className="flex flex-col">
            <div className="px-2 pt-2 pb-1.5 border-b">
              <Input
                variant="ghost"
                autoFocus
                placeholder="Search branches…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                className="h-7"
              />
            </div>
            {/* "Use project default" row — clears the explicit pick. */}
            <button
              type="button"
              onClick={() => {
                onSelectedBranchChange(null);
                setOpen(false);
              }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-left text-sm border-b hover:bg-accent",
                selectedBranch == null && "bg-accent/50",
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium leading-tight">
                  Project default{defaultBranch ? ` (${defaultBranch})` : ""}
                </div>
                <div className="text-xs text-muted-foreground leading-tight">
                  Use the branch the project is currently on.
                </div>
              </div>
              {selectedBranch == null && <CheckIcon className="size-3.5 shrink-0 text-cyan-400" />}
            </button>
            <BranchList
              isLoading={branchesQuery.isLoading}
              isError={branchesQuery.isError}
              error={branchesQuery.error}
              branches={filtered}
              selectedBranch={selectedBranch}
              defaultBranch={defaultBranch}
              activeIndex={activeIndex}
              virtuosoRef={virtuosoRef}
              onPick={(branch) => {
                onSelectedBranchChange(branch);
                setOpen(false);
              }}
            />
          </div>
        </PopoverContent>
      </Popover>

      {/* Hairline divider — matches the model-picker group style. */}
      <div className="w-px bg-border" aria-hidden="true" />

      {/* Worktree toggle segment. */}
      <button
        type="button"
        onClick={onToggleWorktree}
        aria-pressed={useWorktree}
        className={cn(useWorktree ? SEGMENT_ACTIVE : SEGMENT, "rounded-r-md")}
      >
        <GitBranchIcon className="size-3" />
        Use worktree
        {useWorktree && <CheckIcon className="size-3" />}
      </button>
    </div>
  );
});

interface BranchListProps {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  branches: BranchInfo[];
  selectedBranch: string | null;
  defaultBranch: string | undefined;
  activeIndex: number;
  virtuosoRef: React.RefObject<VirtuosoHandle | null>;
  onPick: (branch: string) => void;
}

function BranchList({
  isLoading,
  isError,
  error,
  branches,
  selectedBranch,
  defaultBranch,
  activeIndex,
  virtuosoRef,
  onPick,
}: BranchListProps): ReactElement {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span>Loading branches…</span>
      </div>
    );
  }
  if (isError) {
    return (
      <p className="text-sm text-destructive p-3">
        {error instanceof Error ? error.message : "Failed to load branches."}
      </p>
    );
  }
  if (branches.length === 0) {
    return <p className="text-sm text-muted-foreground p-3 text-center">No matching branches.</p>;
  }
  return (
    <Virtuoso
      ref={virtuosoRef}
      style={{ height: 240 }}
      totalCount={branches.length}
      itemContent={(index) => {
        const branch = branches[index];
        if (!branch) return null;
        const isSelected = selectedBranch === branch.name;
        const isDefault = defaultBranch === branch.name;
        const isActive = index === activeIndex;
        return (
          <button
            type="button"
            onClick={() => onPick(branch.name)}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-accent",
              isSelected && "bg-accent/50",
              isActive && "bg-accent",
            )}
          >
            {/* Leading worktree icon mirrors the sidebar's "has worktree"
                affordance (see ProjectFeatureRow). Picking such a branch
                routes through the `reuse` mode — no fresh worktree is
                created; the conversation lands on the existing one. */}
            {branch.attached_worktree_path ? (
              <GitBranchIcon className="size-3 shrink-0 text-cyan-400" aria-label="Has worktree" />
            ) : (
              <span className="size-3 shrink-0" aria-hidden="true" />
            )}
            <span className="flex-1 truncate font-mono text-xs">{branch.name}</span>
            {isDefault && (
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                default
              </span>
            )}
            {!branch.is_local && (
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                remote
              </span>
            )}
            {branch.attached_feature_id != null && (
              <span className="text-[10px] text-muted-foreground">
                in use by feature #{branch.attached_feature_id}
              </span>
            )}
            {isSelected && <CheckIcon className="size-3 shrink-0 text-cyan-400" />}
          </button>
        );
      }}
    />
  );
}

/**
 * Resolve the live `WorktreeChoice` from the two-chip state. Pulled into a
 * pure helper so the route can call it inside `onSend` without duplicating
 * the rule. Returns `off` when the toggle is off, `reuse` when the picked
 * branch already has an attached worktree, otherwise `new` (with `base`
 * pinned to the explicit pick when the user diverged from the default).
 */
export function resolveWorktreeChoice(args: {
  useWorktree: boolean;
  selectedBranch: string | null;
  branches: BranchInfo[] | undefined;
}): WorktreeChoice {
  if (!args.useWorktree) return { kind: "off" };
  if (args.selectedBranch == null) return { kind: "new", base: null };
  const matched = args.branches?.find((b) => b.name === args.selectedBranch);
  if (matched?.attached_worktree_path) {
    return { kind: "reuse", branch: args.selectedBranch };
  }
  return { kind: "new", base: args.selectedBranch };
}
