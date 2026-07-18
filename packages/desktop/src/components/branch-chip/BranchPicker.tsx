/**
 * Searchable, virtualized branch picker. Repos can have hundreds of branches —
 * `frontend-performance.md` requires virtualization for any list whose size
 * scales with user data, so we render through `react-virtuoso` (already a
 * project dep — we don't add `@tanstack/react-virtual` just for this).
 *
 * Selection triggers `useUpdateTargetBranch`. Per `no-optimistic-updates.md`
 * we don't manually invalidate after success; the backend WS push drives it.
 */
import { useCallback, useState, type ReactElement } from "react";
import { Loader2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { useListBranches, useUpdateTargetBranch, type BranchInfo } from "@/api/generated";
import { cn } from "@/lib/utils";
import { apiErrorMessage, toastError } from "@/lib/api-errors";
import { useBranchList, type BranchListRowContext } from "./BranchList";

interface BranchPickerProps {
  featureId: number;
  projectId: number;
  currentTarget: string | null | undefined;
  onPicked: () => void;
}

export function BranchPicker({
  featureId,
  projectId,
  currentTarget,
  onPicked,
}: BranchPickerProps): ReactElement {
  const branchesQuery = useListBranches({ project_id: projectId });
  const [query, setQuery] = useState("");
  const [pendingName, setPendingName] = useState<string | null>(null);

  const updateTarget = useUpdateTargetBranch();

  const pick = useCallback(
    async (name: string): Promise<void> => {
      if (name === currentTarget) {
        onPicked();
        return;
      }
      setPendingName(name);
      try {
        await updateTarget.mutateAsync({ id: featureId, data: { target_branch: name } });
        onPicked();
      } catch (err) {
        toastError(err, "Failed to update target branch.");
      } finally {
        setPendingName(null);
      }
    },
    [currentTarget, featureId, onPicked, updateTarget],
  );

  const onPickBranch = useCallback((b: BranchInfo) => void pick(b.name), [pick]);

  const renderRow = useCallback(
    ({ branch, isActive }: BranchListRowContext) => (
      <BranchRow
        branch={branch}
        isCurrentTarget={branch.name === currentTarget}
        isActive={isActive}
        isPending={pendingName === branch.name}
        onSelect={() => pick(branch.name)}
      />
    ),
    [currentTarget, pendingName, pick],
  );

  const branches = branchesQuery.data ?? [];
  const { list, onKeyDown } = useBranchList({
    branches,
    query,
    onPick: onPickBranch,
    renderRow,
    emptyState: (
      <p className="text-sm text-muted-foreground p-3 text-center">No matching branches.</p>
    ),
  });

  return (
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
      {branchesQuery.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>Loading branches…</span>
        </div>
      ) : branchesQuery.isError ? (
        <p className="text-sm text-destructive p-3">
          {apiErrorMessage(branchesQuery.error, "Failed to load branches.")}
        </p>
      ) : (
        list
      )}
    </div>
  );
}

interface BranchRowProps {
  branch: BranchInfo;
  isCurrentTarget: boolean;
  isActive: boolean;
  isPending: boolean;
  onSelect: () => void;
}

function BranchRow({
  branch,
  isCurrentTarget,
  isActive,
  isPending,
  onSelect,
}: BranchRowProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={isPending}
      aria-label={`Select ${branch.is_local ? "local" : "remote"} branch ${branch.name}`}
      className={cn(
        "w-full flex items-center gap-2 px-2 py-1.5 text-sm text-left hover:bg-accent disabled:opacity-50",
        isCurrentTarget && "bg-accent/50",
        isActive && "bg-accent",
      )}
    >
      <span className="flex-1 truncate font-mono text-xs">{branch.name}</span>
      {!branch.is_local && (
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">remote</span>
      )}
      {branch.attached_feature_id != null && (
        <span className="text-[10px] text-muted-foreground">
          in use by feature #{branch.attached_feature_id}
        </span>
      )}
      {isPending && <Loader2 className="size-3 animate-spin" />}
    </button>
  );
}
