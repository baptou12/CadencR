import type { UncommittedFile } from "@/api/generated";

export type UncommittedFileBucket = "staged" | "both" | "unstaged" | "untracked";

export interface UncommittedFileGroup {
  key: UncommittedFileBucket;
  label: string;
  files: UncommittedFile[];
}

export function groupUncommittedFiles(files: UncommittedFile[]): UncommittedFileGroup[] {
  const staged: UncommittedFile[] = [];
  const unstaged: UncommittedFile[] = [];
  const untracked: UncommittedFile[] = [];
  for (const file of files) {
    if (file.status === "staged" || file.status === "both") staged.push(file);
    if (file.status === "unstaged" || file.status === "both") unstaged.push(file);
    if (file.status === "untracked") untracked.push(file);
  }
  const groups: UncommittedFileGroup[] = [
    { key: "staged", label: "Staged", files: staged },
    { key: "unstaged", label: "Unstaged", files: unstaged },
    { key: "untracked", label: "Untracked", files: untracked },
  ];
  return groups.filter((group) => group.files.length > 0);
}

/** Stash preview groups every path once, including files changed in both indexes. */
export function groupStashFiles(files: UncommittedFile[]): UncommittedFileGroup[] {
  const staged: UncommittedFile[] = [];
  const both: UncommittedFile[] = [];
  const unstaged: UncommittedFile[] = [];
  const untracked: UncommittedFile[] = [];
  for (const file of files) {
    if (file.status === "staged") staged.push(file);
    else if (file.status === "both") both.push(file);
    else if (file.status === "unstaged") unstaged.push(file);
    else untracked.push(file);
  }
  const groups: UncommittedFileGroup[] = [
    { key: "staged", label: "Staged", files: staged },
    { key: "both", label: "Staged & unstaged", files: both },
    { key: "unstaged", label: "Unstaged", files: unstaged },
    { key: "untracked", label: "Untracked", files: untracked },
  ];
  return groups.filter((group) => group.files.length > 0);
}
