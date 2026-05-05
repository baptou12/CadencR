import { useState, type KeyboardEvent, type ReactElement } from "react";
import { GitMerge, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetWorkspaceSettingQueryKey,
  useGetWorkspaceSetting,
  useMergeFeatureBranch,
} from "@/api/generated";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GIT_MERGE_MODE_KEY,
  GIT_MERGE_MODE_OPTIONS,
  gitMergeModeLabel,
  parseGitMergeMode,
  type GitMergeMode,
} from "@/lib/git-merge-mode";
import { selectGitStatus, useGitStatusStore } from "@/stores/useGitStatusStore";

interface MergeDialogProps {
  featureId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function MergeDialog({
  featureId,
  open,
  onOpenChange,
}: MergeDialogProps): ReactElement {
  const snapshot = useGitStatusStore(selectGitStatus(featureId));
  const setting = useGetWorkspaceSetting(GIT_MERGE_MODE_KEY, { query: { enabled: open } });
  const [mode, setMode] = useState<GitMergeMode | null>(null);
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const merge = useMergeFeatureBranch();

  const effectiveMode = mode ?? parseGitMergeMode(setting.data?.value);
  const submitting = merge.isPending;

  async function handleMerge(): Promise<void> {
    if (submitting) return;
    setError(null);
    try {
      const result = await merge.mutateAsync({
        data: {
          feature_id: featureId,
          mode: effectiveMode,
          save_as_default: saveAsDefault,
        },
      });
      if (!result.success) {
        showError(result.error ?? "Merge failed.");
        return;
      }
      if (saveAsDefault) {
        void queryClient.invalidateQueries({
          queryKey: getGetWorkspaceSettingQueryKey(GIT_MERGE_MODE_KEY),
        });
      }
      toast.success(`Merged with ${gitMergeModeLabel(effectiveMode)}`);
      onOpenChange(false);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Merge failed.");
    }
  }

  function showError(message: string): void {
    setError(message);
    toast.error(message);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== "Enter") return;
    if (!(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    void handleMerge();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="size-5" />
            Merge branch
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border p-3 text-sm">
            <div className="font-mono">
              {snapshot?.current_branch ?? "current"} → {snapshot?.target_branch ?? "target"}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Remote targets such as origin/main are merged into their local branch, e.g. main.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="merge-mode" className="text-sm font-medium">
              Merge option
            </label>
            <Select value={effectiveMode} onValueChange={(value) => setMode(value as GitMergeMode)}>
              <SelectTrigger id="merge-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GIT_MERGE_MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {GIT_MERGE_MODE_OPTIONS.find((option) => option.value === effectiveMode)?.description}
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={saveAsDefault}
              onCheckedChange={(checked) => setSaveAsDefault(checked === true)}
            />
            Save as default
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleMerge} disabled={submitting} title="Merge (⌘ Enter)">
            {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
            Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
