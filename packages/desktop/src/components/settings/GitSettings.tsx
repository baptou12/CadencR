import type { ReactElement } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetWorkspaceSettingQueryKey,
  useGetWorkspaceSetting,
  useSetWorkspaceSetting,
} from "@/api/generated";
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
  parseGitMergeMode,
  type GitMergeMode,
} from "@/lib/git-merge-mode";

export function GitSettings(): ReactElement {
  const queryClient = useQueryClient();
  const setting = useGetWorkspaceSetting(GIT_MERGE_MODE_KEY);
  const setSetting = useSetWorkspaceSetting({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetWorkspaceSettingQueryKey(GIT_MERGE_MODE_KEY),
        });
        toast.success("Settings saved");
      },
      onError: (err: Error) => {
        toast.error(err.message);
      },
    },
  });

  const value = parseGitMergeMode(setting.data?.value);
  const selected = GIT_MERGE_MODE_OPTIONS.find((option) => option.value === value);

  function updateMergeMode(next: GitMergeMode): void {
    setSetting.mutate({
      key: GIT_MERGE_MODE_KEY,
      data: { value: next },
    });
  }

  return (
    <div className="space-y-2">
      <label htmlFor="git-merge-strategy" className="text-sm font-medium">
        Merge Strategy
      </label>
      <Select
        value={value}
        onValueChange={(next) => updateMergeMode(next as GitMergeMode)}
        disabled={setSetting.isPending}
      >
        <SelectTrigger id="git-merge-strategy" className="w-48">
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
        {selected?.description ?? "Choose the default option used by the Merge action."}
      </p>
    </div>
  );
}
