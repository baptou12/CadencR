import { CommandDialog } from "@/components/ui/command";
import {
  WorktreeChoice,
  isWorktreeChoiceValid,
  type WorktreeChoiceValue,
} from "@/components/command-palette/WorktreeChoice";

interface CommandPaletteWorktreeStepProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  value: WorktreeChoiceValue;
  onChange: (value: WorktreeChoiceValue) => void;
  onConfirm: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export function CommandPaletteWorktreeStep({
  open,
  onOpenChange,
  projectId,
  value,
  onChange,
  onConfirm,
  onKeyDown,
}: CommandPaletteWorktreeStepProps) {
  const canSubmit = isWorktreeChoiceValid(value);
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      commandProps={{ shouldFilter: false, onKeyDown }}
    >
      <div className="border-b px-4 py-3 text-sm font-medium">New feature: choose worktree</div>
      <WorktreeChoice projectId={projectId} value={value} onChange={onChange} />
      <div className="flex items-center justify-between border-t px-3 py-2 text-xs">
        <span className="text-muted-foreground">
          {canSubmit ? "Press Enter to create" : "Pick a branch to continue"}
        </span>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!canSubmit}
          className="bg-primary text-primary-foreground rounded-md px-3 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          Create feature
        </button>
      </div>
    </CommandDialog>
  );
}
