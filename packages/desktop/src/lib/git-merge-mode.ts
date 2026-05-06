export const GIT_MERGE_MODE_KEY = "git_merge_mode";

export const GIT_MERGE_MODES = ["default", "no_ff", "ff_only", "squash"] as const;

export type GitMergeMode = (typeof GIT_MERGE_MODES)[number];

export const DEFAULT_GIT_MERGE_MODE: GitMergeMode = "no_ff";

export interface GitMergeModeOption {
  value: GitMergeMode;
  label: string;
  description: string;
}

export const GIT_MERGE_MODE_OPTIONS: GitMergeModeOption[] = [
  {
    value: "default",
    label: "Default",
    description: "Use Git's default merge behavior.",
  },
  {
    value: "no_ff",
    label: "--no-ff",
    description: "Always create a merge commit.",
  },
  {
    value: "ff_only",
    label: "--ff-only",
    description: "Only merge when a fast-forward is possible.",
  },
  {
    value: "squash",
    label: "--squash",
    description: "Stage the combined changes without creating a merge commit.",
  },
];

export function parseGitMergeMode(value: string | null | undefined): GitMergeMode {
  return GIT_MERGE_MODES.includes(value as GitMergeMode)
    ? (value as GitMergeMode)
    : DEFAULT_GIT_MERGE_MODE;
}

export function gitMergeModeLabel(value: GitMergeMode): string {
  return GIT_MERGE_MODE_OPTIONS.find((option) => option.value === value)?.label ?? "--no-ff";
}
