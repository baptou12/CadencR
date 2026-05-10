import type { ReactElement } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetWorkspaceSettingQueryKey,
  useGetWorkspaceSetting,
  useSetWorkspaceSetting,
} from "@/api/generated";
import { RadioCardGroup, type RadioCardOption } from "./RadioCardGroup";
import {
  GIT_MERGE_MODE_KEY,
  GIT_MERGE_MODE_OPTIONS,
  parseGitMergeMode,
  type GitMergeMode,
} from "@/lib/git-merge-mode";

/** CSS color var per merge mode — mirrors the design's accent-tinted flag chips. */
const MERGE_FLAG_COLOR_VAR: Record<GitMergeMode, string> = {
  default: "var(--muted-foreground)",
  no_ff: "var(--acc-purple)",
  ff_only: "var(--acc-cyan)",
  squash: "var(--acc-orange)",
};

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

  const options: RadioCardOption<GitMergeMode>[] = GIT_MERGE_MODE_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    description: option.description,
    visual: (
      <span
        className="mt-0.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]"
        style={{ color: MERGE_FLAG_COLOR_VAR[option.value] }}
      >
        {option.flag}
      </span>
    ),
  }));

  return (
    <RadioCardGroup<GitMergeMode>
      ariaLabel="Merge strategy"
      value={value}
      onChange={updateMergeMode}
      options={options}
      layout="grid"
      disabled={setSetting.isPending}
    />
  );
}
