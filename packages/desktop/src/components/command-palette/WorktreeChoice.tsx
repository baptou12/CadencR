import { useCallback, useMemo, useState } from "react";
import { GitBranchIcon, FolderPlusIcon, BanIcon } from "lucide-react";
import {
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useListBranches, type BranchInfo } from "@/api/generated";
import { useBranchList, type BranchListRowContext } from "@/components/branch-chip/BranchList";

export type WorktreeChoiceValue =
  | { mode: "new" }
  | { mode: "skip" }
  | { mode: "reuse"; branch: string };

export function isWorktreeChoiceValid(value: WorktreeChoiceValue): boolean {
  if (value.mode === "new" || value.mode === "skip") return true;
  return value.branch.trim().length > 0;
}

interface WorktreeChoiceProps {
  projectId: number;
  value: WorktreeChoiceValue;
  onChange: (value: WorktreeChoiceValue) => void;
}

export function WorktreeChoice({ projectId, value, onChange }: WorktreeChoiceProps) {
  const [search, setSearch] = useState("");

  const branchesQuery = useListBranches(
    { project_id: projectId },
    { query: { enabled: value.mode === "reuse" } },
  );

  const handlePickNew = useCallback(() => {
    onChange({ mode: "new" });
  }, [onChange]);

  const handlePickSkip = useCallback(() => {
    onChange({ mode: "skip" });
  }, [onChange]);

  const handlePickReuseRow = useCallback(() => {
    if (value.mode !== "reuse") {
      onChange({ mode: "reuse", branch: "" });
    }
  }, [onChange, value.mode]);

  const handleSelectBranch = useCallback(
    (branch: string) => {
      onChange({ mode: "reuse", branch });
    },
    [onChange],
  );

  const onPickBranch = useCallback(
    (b: BranchInfo) => handleSelectBranch(b.name),
    [handleSelectBranch],
  );

  const localBranches = useMemo(
    () => (branchesQuery.data ?? []).filter((b: BranchInfo) => b.is_local),
    [branchesQuery.data],
  );

  const selectedBranch = value.mode === "reuse" ? value.branch : "";

  return (
    <div className="flex flex-col">
      <CommandList>
        <CommandGroup heading="Worktree">
          <ModeRow
            active={value.mode === "new"}
            onSelect={handlePickNew}
            icon={<FolderPlusIcon className="mr-2" />}
            label="New worktree"
            description="Create a fresh branch on a new worktree"
          />
          <ModeRow
            active={value.mode === "skip"}
            onSelect={handlePickSkip}
            icon={<BanIcon className="mr-2" />}
            label="No worktree"
            description="Run in the project directory for this conversation"
          />
          <ModeRow
            active={value.mode === "reuse"}
            onSelect={handlePickReuseRow}
            icon={<GitBranchIcon className="mr-2" />}
            label="Reuse existing branch"
            description="Attach a worktree to an existing local branch"
          />
        </CommandGroup>
      </CommandList>

      {value.mode === "reuse" && (
        <>
          <CommandSeparator />
          <ReuseBranchSection
            search={search}
            onSearchChange={setSearch}
            isLoading={branchesQuery.isLoading}
            isError={branchesQuery.isError}
            error={branchesQuery.error}
            branches={localBranches}
            selectedBranch={selectedBranch}
            onPickBranch={onPickBranch}
          />
        </>
      )}
    </div>
  );
}

interface ModeRowProps {
  active: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  label: string;
  description: string;
}

function ModeRow({ active, onSelect, icon, label, description }: ModeRowProps) {
  return (
    <CommandItem onSelect={onSelect} data-state={active ? "checked" : "unchecked"}>
      {icon}
      <div className="flex flex-col">
        <span>{label}</span>
        <span className="text-muted-foreground text-xs">{description}</span>
      </div>
      {active && <span className="ml-auto text-xs">Selected</span>}
    </CommandItem>
  );
}

interface ReuseBranchSectionProps {
  search: string;
  onSearchChange: (s: string) => void;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  branches: BranchInfo[];
  selectedBranch: string;
  onPickBranch: (branch: BranchInfo) => void;
}

function ReuseBranchSection({
  search,
  onSearchChange,
  isLoading,
  isError,
  error,
  branches,
  selectedBranch,
  onPickBranch,
}: ReuseBranchSectionProps) {
  const renderRow = useCallback(
    ({ branch, isActive }: BranchListRowContext) => (
      <BranchRow
        branch={branch}
        isSelected={branch.name === selectedBranch}
        isActive={isActive}
        onSelect={onPickBranch}
      />
    ),
    [selectedBranch, onPickBranch],
  );

  const { list, onKeyDown } = useBranchList({
    branches,
    query: search,
    onPick: onPickBranch,
    renderRow,
    height: 240,
    emptyState: (
      <div className="text-muted-foreground py-6 text-center text-sm">No matching branches.</div>
    ),
  });

  if (isLoading) {
    return (
      <div className="text-muted-foreground py-6 text-center text-sm">Loading branches...</div>
    );
  }

  if (isError) {
    const msg = error instanceof Error ? error.message : "Failed to load branches";
    return (
      <div className="text-destructive py-6 text-center text-sm" role="alert">
        {msg}
      </div>
    );
  }

  if (branches.length === 0) {
    return (
      <div className="text-muted-foreground py-6 text-center text-sm">No branches available.</div>
    );
  }

  return (
    <>
      <CommandInput
        placeholder="Search branches..."
        value={search}
        onValueChange={onSearchChange}
        onKeyDown={onKeyDown}
        autoFocus
      />
      {list}
    </>
  );
}

interface BranchRowProps {
  branch: BranchInfo;
  isSelected: boolean;
  isActive: boolean;
  onSelect: (branch: BranchInfo) => void;
}

function BranchRow({ branch, isSelected, isActive, onSelect }: BranchRowProps) {
  const handleSelect = useCallback(() => {
    onSelect(branch);
  }, [branch, onSelect]);

  return (
    <button
      type="button"
      onClick={handleSelect}
      data-state={isSelected ? "checked" : "unchecked"}
      className={[
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent",
        isSelected && "bg-accent/50",
        isActive && "bg-accent",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <GitBranchIcon className="mr-2" />
      <span className="truncate">{branch.name}</span>
      {branch.attached_feature_id != null && (
        <span className="text-muted-foreground ml-2 truncate text-xs">
          in use by feature #{branch.attached_feature_id}
        </span>
      )}
      {isSelected && <span className="ml-auto text-xs">Selected</span>}
    </button>
  );
}
