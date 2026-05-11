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
 *                     unless the picked branch already has a worktree.
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
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useListBranches, useValidateCheckout, type BranchInfo } from "@/api/generated";
import { useBranchList, type BranchListRowContext } from "@/components/branch-chip/BranchList";
import { apiErrorMessage } from "@/lib/api-errors";

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
  "inline-flex h-full items-center gap-1.5 px-2.5 transition-colors bg-[var(--chip-worktree-bg)] text-[var(--chip-worktree-fg)] hover:bg-[var(--chip-worktree-bg-hover)]";
const EMPTY_BRANCHES: BranchInfo[] = [];

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
  const branches = branchesQuery.data ?? EMPTY_BRANCHES;
  const selectedBranchChoice = useMemo(
    () =>
      resolveWorktreeChoice({
        useWorktree: true,
        selectedBranch,
        branches,
      }),
    [branches, selectedBranch],
  );
  const lockedWorktreeToggle = selectedBranchChoice.kind === "reuse";
  const validateCheckout = useValidateCheckout();
  const validateMutateAsync = validateCheckout.mutateAsync;

  const handlePick = useCallback(
    async (branch: BranchInfo) => {
      // Branch already lives in a worktree — drop into it.
      if (branch.attached_worktree_path) {
        onSelectedBranchChange(branch.name);
        if (!useWorktree) onToggleWorktree();
        setOpen(false);
        return;
      }
      // Picking the project's current branch is a no-op — same as "Project default".
      if (branch.name === defaultBranch) {
        onSelectedBranchChange(null);
        setOpen(false);
        return;
      }
      // Heuristic dry-run via the backend. The real `git checkout` runs at
      // first-prompt send in `useAgentSendHandler` — we only persist the
      // selection if the dry-run is happy.
      try {
        await validateMutateAsync({ data: { project_id: projectId, branch: branch.name } });
        onSelectedBranchChange(branch.name);
        setOpen(false);
      } catch (err) {
        toast.error(apiErrorMessage(err, "Could not switch to this branch"));
      }
    },
    [
      defaultBranch,
      onSelectedBranchChange,
      onToggleWorktree,
      projectId,
      useWorktree,
      validateMutateAsync,
    ],
  );
  const handleToggleWorktree = useCallback((): void => {
    if (lockedWorktreeToggle) return;
    onToggleWorktree();
  }, [lockedWorktreeToggle, onToggleWorktree]);
  const renderBranchRow = useCallback(
    (ctx: BranchListRowContext) => (
      <BranchRow
        branch={ctx.branch}
        isActive={ctx.isActive}
        isDefault={defaultBranch === ctx.branch.name}
        isSelected={selectedBranch === ctx.branch.name}
        onPick={handlePick}
      />
    ),
    [defaultBranch, handlePick, selectedBranch],
  );
  const branchList = useBranchList({
    branches,
    query,
    onPick: handlePick,
    renderRow: renderBranchRow,
    height: 240,
    emptyState: (
      <p className="text-sm text-muted-foreground p-3 text-center">No matching branches.</p>
    ),
  });

  // What label shows in the chip when the user hasn't picked anything yet.
  const effectiveBranch = selectedBranch ?? defaultBranch ?? null;
  const branchLabel = effectiveBranch ?? "branch";
  const worktreeToggleButton = (
    <button
      type="button"
      onClick={handleToggleWorktree}
      aria-pressed={useWorktree || lockedWorktreeToggle}
      className={cn(useWorktree || lockedWorktreeToggle ? SEGMENT_ACTIVE : SEGMENT, "rounded-r-md")}
    >
      <GitBranchIcon className="size-3" />
      Use worktree
      {(useWorktree || lockedWorktreeToggle) && <CheckIcon className="size-3" />}
    </button>
  );

  return (
    <div className={GROUP}>
      {/* Branch segment — search/select; default-highlighted = project HEAD.
          Always rendered in the active style: a branch is always selected
          (project default when the user hasn't picked anything), so this
          segment is never in a "no value" state. */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(SEGMENT_ACTIVE, "rounded-l-md")}
            aria-busy={validateCheckout.isPending}
            disabled={validateCheckout.isPending}
          >
            <GitBranchIcon className="size-3" />
            <span className="truncate max-w-[160px]">{branchLabel}</span>
            {validateCheckout.isPending ? (
              <Loader2 className="size-3 animate-spin opacity-70" />
            ) : (
              <ChevronDownIcon className="size-3 opacity-70" />
            )}
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
                onKeyDown={branchList.onKeyDown}
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
              {selectedBranch == null && (
                <CheckIcon className="size-3.5 shrink-0 text-[var(--chip-worktree-fg)]" />
              )}
            </button>
            <BranchList
              isLoading={branchesQuery.isLoading}
              isError={branchesQuery.isError}
              error={branchesQuery.error}
              list={branchList.list}
            />
          </div>
        </PopoverContent>
      </Popover>

      {/* Hairline divider — matches the model-picker group style. */}
      <div className="w-px bg-border" aria-hidden="true" />

      {/* Worktree toggle segment. */}
      {lockedWorktreeToggle ? (
        <Popover>
          <PopoverTrigger asChild>{worktreeToggleButton}</PopoverTrigger>
          <PopoverContent align="end" side="top" className="w-72 space-y-2 p-3 text-xs">
            <div className="font-medium text-foreground">Existing worktree selected</div>
            <p className="text-muted-foreground">
              <span className="font-mono text-foreground">{selectedBranch}</span> is already checked
              out in a worktree. Cadencr will reuse that existing worktree.
            </p>
            <p className="text-muted-foreground">No new branch will be created.</p>
          </PopoverContent>
        </Popover>
      ) : (
        worktreeToggleButton
      )}
    </div>
  );
});

interface BranchListProps {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  list: ReactElement;
}

function BranchList({ isLoading, isError, error, list }: BranchListProps): ReactElement {
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
  return list;
}

interface BranchRowProps {
  branch: BranchInfo;
  isActive: boolean;
  isDefault: boolean;
  isSelected: boolean;
  onPick: (branch: BranchInfo) => void;
}

function BranchRow({
  branch,
  isActive,
  isDefault,
  isSelected,
  onPick,
}: BranchRowProps): ReactElement {
  return (
    <button
      type="button"
      onClick={() => onPick(branch)}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-accent",
        isSelected && "bg-accent/50",
        isActive && "bg-accent",
      )}
    >
      {/* Leading worktree icon mirrors the sidebar's "has worktree"
          affordance (see ProjectFeatureRow). Picking such a branch
          routes through the `reuse` mode — no fresh worktree is created;
          the conversation lands on the existing one. */}
      {branch.attached_worktree_path ? (
        <GitBranchIcon
          className="size-3 shrink-0 text-[var(--chip-worktree-fg)]"
          aria-label="Has worktree"
        />
      ) : (
        <span className="size-3 shrink-0" aria-hidden="true" />
      )}
      <span className="flex-1 truncate font-mono text-xs">{branch.name}</span>
      {isDefault && (
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">default</span>
      )}
      {!branch.is_local && (
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">remote</span>
      )}
      {branch.attached_feature_id != null && (
        <span className="text-[10px] text-muted-foreground">
          in use by feature #{branch.attached_feature_id}
        </span>
      )}
      {isSelected && <CheckIcon className="size-3 shrink-0 text-[var(--chip-worktree-fg)]" />}
    </button>
  );
}

/**
 * Resolve the live `WorktreeChoice` from the two-chip state. Pulled into a
 * pure helper so the route can call it inside `onSend` without duplicating
 * the rule. Returns `reuse` when the picked branch already has an attached
 * worktree, even if the toggle is off, otherwise respects the toggle: `off`
 * when disabled or `new` when enabled (with `base` pinned to the explicit
 * pick when the user diverged from the default).
 */
export function resolveWorktreeChoice(args: {
  useWorktree: boolean;
  selectedBranch: string | null;
  branches: BranchInfo[] | undefined;
}): WorktreeChoice {
  if (args.selectedBranch == null) {
    return args.useWorktree ? { kind: "new", base: null } : { kind: "off" };
  }
  const matched = args.branches?.find((b) => b.name === args.selectedBranch);
  if (matched?.attached_worktree_path) {
    return { kind: "reuse", branch: args.selectedBranch };
  }
  return args.useWorktree ? { kind: "new", base: args.selectedBranch } : { kind: "off" };
}
