import type { ReactElement } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetWorkspaceSettingQueryKey,
  useGetWorkspaceSetting,
  useSetWorkspaceSetting,
} from "@/api/generated";
import { RadioCardGroup } from "./RadioCardGroup";
import { GIT_MERGE_RADIO_OPTIONS } from "./gitMergeRadioOptions";
import { GIT_MERGE_MODE_KEY, parseGitMergeMode, type GitMergeMode } from "@/lib/git-merge-mode";

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

  function updateMergeMode(next: GitMergeMode): void {
    setSetting.mutate({ key: GIT_MERGE_MODE_KEY, data: { value: next } });
  }

  return (
    <RadioCardGroup<GitMergeMode>
      ariaLabel="Merge strategy"
      value={value}
      onChange={updateMergeMode}
      options={GIT_MERGE_RADIO_OPTIONS}
      layout="grid"
      disabled={setSetting.isPending}
    />
  );
}
