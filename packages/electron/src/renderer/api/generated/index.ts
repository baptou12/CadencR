/**
 * Generated-style React Query v4 hooks for the Rust git backend.
 *
 * These hooks mirror the output that `orval` would produce from the Rust
 * OpenAPI spec.  Run `pnpm generate:api` to regenerate once the Rust
 * backend is running.
 */

import { useQuery, useMutation, type UseQueryOptions, type UseMutationOptions } from "@tanstack/react-query";
import { customInstance, type ErrorType } from "../client";

// ---------------------------------------------------------------------------
// Types — match the Rust models (snake_case JSON)
// ---------------------------------------------------------------------------

export interface BranchResponse {
  branch: string | null;
}

export interface GitStats {
  files_changed: number;
  insertions: number;
  deletions: number;
}

export interface DiffResponse {
  diff: string;
}

export interface ChangedFile {
  file: string;
  status: string;
  old_file?: string;
  additions: number;
  deletions: number;
}

export interface FileContent {
  old_content: string | null;
  new_content: string | null;
}

export interface FileContentBatchItem {
  file_path: string;
  old_content: string | null;
  new_content: string | null;
}

export interface CommitLogEntry {
  sha: string;
  short_sha: string;
  message: string;
  body: string;
  author: string;
  date: string;
  is_pushed: boolean;
}

export interface CommitLogResponse {
  commits: CommitLogEntry[];
  is_on_base_branch: boolean;
}

export interface FileBlobSha {
  file_path: string;
  sha: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  is_bare: boolean;
}

export interface ProjectWorktreeInfo {
  path: string;
  branch: string;
  head: string;
  feature_id: number | null;
  feature_title: string | null;
  feature_status: string | null;
}

export interface MergeConflictResult {
  has_conflicts: boolean;
  conflict_files: string[];
}

export interface MergeResult {
  success: boolean;
  error?: string;
}

export interface OriginalBranchResponse {
  original_branch: string;
  worktree_branch: string;
}

export interface SuccessResponse {
  success: boolean;
  error?: string;
}

export interface HasUncommittedChangesResponse {
  has_changes: boolean;
}

export interface CreateWorktreeResponse {
  worktree_path: string;
  branch: string;
}

// ---------------------------------------------------------------------------
// Request param types
// ---------------------------------------------------------------------------

export interface GetBranchParams {
  projectId: number;
}

export interface GetStatsParams {
  featureId: number;
  mode?: string;
  targetBranch?: string;
}

export interface GetDiffParams {
  featureId: number;
  mode: string;
  commitSha?: string;
  targetBranch?: string;
}

export interface GetChangedFilesParams {
  featureId: number;
  mode: string;
  targetBranch?: string;
}

export interface GetFileContentParams {
  featureId: number;
  filePath: string;
  mode: string;
  commitSha?: string;
  targetBranch?: string;
}

export interface GetFileContentBatchParams {
  featureId: number;
  filePaths: string[];
  mode: string;
  commitSha?: string;
  targetBranch?: string;
}

export interface GetCommitLogParams {
  featureId: number;
  limit?: number;
}

export interface GetFileBlobShasParams {
  featureId: number;
}

export interface ListFilesParams {
  featureId: number;
}

export interface WorktreeInfoParams {
  projectId: number;
  featureId: number;
}

export interface CreateWorktreeParams {
  projectId: number;
  featureId: number;
  featureTitle: string;
}

export interface RemoveWorktreeParams {
  projectId: number;
  featureId: number;
}

export interface DeleteWorktreeParams {
  projectId: number;
  featureId: number;
}

export interface RetryWorktreeParams {
  projectId: number;
  featureId: number;
}

export interface ListProjectWorktreesParams {
  projectId: number;
}

export interface RemoveOrphanWorktreeParams {
  projectId: number;
  worktreePath: string;
}

export interface GetOriginalBranchParams {
  projectId: number;
  featureId: number;
}

export interface CheckMergeConflictsParams {
  projectId: number;
  featureId: number;
}

export interface MergeFeatureBranchParams {
  projectId: number;
  featureId: number;
}

export interface DeleteFeatureBranchParams {
  projectId: number;
  featureId: number;
}

export interface HasUncommittedChangesParams {
  projectId: number;
  featureId: number;
}

// ---------------------------------------------------------------------------
// Helpers — convert camelCase params to snake_case query strings
// ---------------------------------------------------------------------------

function toSnakeParams(params: object): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    const snakeKey = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    out[snakeKey] = String(value);
  }
  return out;
}

function qs(params: Record<string, string>): string {
  const s = new URLSearchParams(params).toString();
  return s ? `?${s}` : "";
}

// ---------------------------------------------------------------------------
// Query key factories
// ---------------------------------------------------------------------------

export function getGetBranchQueryKey(params: GetBranchParams) {
  return ["git", "branch", params] as const;
}

export function getGetStatsQueryKey(params: GetStatsParams) {
  return ["git", "stats", params] as const;
}

export function getGetDiffQueryKey(params: GetDiffParams) {
  return ["git", "diff", params] as const;
}

export function getGetChangedFilesQueryKey(params: GetChangedFilesParams) {
  return ["git", "changed-files", params] as const;
}

export function getGetFileContentQueryKey(params: GetFileContentParams) {
  return ["git", "file-content", params] as const;
}

export function getGetFileContentBatchQueryKey(params: GetFileContentBatchParams) {
  return ["git", "file-content-batch", params] as const;
}

export function getGetCommitLogQueryKey(params: GetCommitLogParams) {
  return ["git", "commit-log", params] as const;
}

export function getGetFileBlobShasQueryKey(params: GetFileBlobShasParams) {
  return ["git", "file-blob-shas", params] as const;
}

export function getListFilesQueryKey(params: ListFilesParams) {
  return ["git", "files", params] as const;
}

export function getGetWorktreeInfoQueryKey(params: WorktreeInfoParams) {
  return ["git", "worktree-info", params] as const;
}

export function getListProjectWorktreesQueryKey(params: ListProjectWorktreesParams) {
  return ["git", "worktrees", params] as const;
}

export function getGetOriginalBranchQueryKey(params: GetOriginalBranchParams) {
  return ["git", "original-branch", params] as const;
}

export function getCheckMergeConflictsQueryKey(params: CheckMergeConflictsParams) {
  return ["git", "merge-conflicts", params] as const;
}

export function getHasUncommittedChangesQueryKey(params: HasUncommittedChangesParams) {
  return ["git", "has-uncommitted-changes", params] as const;
}

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

export function useGetBranch(
  params: GetBranchParams,
  options?: Omit<UseQueryOptions<BranchResponse, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<BranchResponse, ErrorType<unknown>>({
    queryKey: getGetBranchQueryKey(params),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/git/branch${qs(toSnakeParams(params))}` }),
    ...options,
  });
}

export function useGetStats(
  params: GetStatsParams,
  options?: Omit<UseQueryOptions<GitStats, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<GitStats, ErrorType<unknown>>({
    queryKey: getGetStatsQueryKey(params),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/git/stats${qs(toSnakeParams(params))}` }),
    ...options,
  });
}

export function useGetDiff(
  params: GetDiffParams,
  options?: Omit<UseQueryOptions<DiffResponse, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<DiffResponse, ErrorType<unknown>>({
    queryKey: getGetDiffQueryKey(params),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/git/diff${qs(toSnakeParams(params))}` }),
    ...options,
  });
}

export function useGetChangedFiles(
  params: GetChangedFilesParams,
  options?: Omit<UseQueryOptions<ChangedFile[], ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<ChangedFile[], ErrorType<unknown>>({
    queryKey: getGetChangedFilesQueryKey(params),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/git/changed-files${qs(toSnakeParams(params))}` }),
    ...options,
  });
}

export function useGetFileContent(
  params: GetFileContentParams,
  options?: Omit<UseQueryOptions<FileContent, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<FileContent, ErrorType<unknown>>({
    queryKey: getGetFileContentQueryKey(params),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/git/file-content${qs(toSnakeParams(params))}` }),
    ...options,
  });
}

export function useGetFileContentBatch(
  params: GetFileContentBatchParams,
  options?: Omit<UseQueryOptions<FileContentBatchItem[], ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<FileContentBatchItem[], ErrorType<unknown>>({
    queryKey: getGetFileContentBatchQueryKey(params),
    queryFn: () =>
      customInstance({
        method: "POST",
        url: "/api/git/file-content-batch",
        data: {
          feature_id: params.featureId,
          file_paths: params.filePaths,
          mode: params.mode,
          commit_sha: params.commitSha,
          target_branch: params.targetBranch,
        },
      }),
    ...options,
  });
}

export function useGetCommitLog(
  params: GetCommitLogParams,
  options?: Omit<UseQueryOptions<CommitLogResponse, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<CommitLogResponse, ErrorType<unknown>>({
    queryKey: getGetCommitLogQueryKey(params),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/git/commit-log${qs(toSnakeParams(params))}` }),
    ...options,
  });
}

export function useGetFileBlobShas(
  params: GetFileBlobShasParams,
  options?: Omit<UseQueryOptions<FileBlobSha[], ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<FileBlobSha[], ErrorType<unknown>>({
    queryKey: getGetFileBlobShasQueryKey(params),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/git/file-blob-shas${qs(toSnakeParams(params))}` }),
    ...options,
  });
}

export function useListFiles(
  params: ListFilesParams,
  options?: Omit<UseQueryOptions<string[], ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<string[], ErrorType<unknown>>({
    queryKey: getListFilesQueryKey(params),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/git/files${qs(toSnakeParams(params))}` }),
    ...options,
  });
}

export function useGetWorktreeInfo(
  params: WorktreeInfoParams,
  options?: Omit<UseQueryOptions<WorktreeInfo | null, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<WorktreeInfo | null, ErrorType<unknown>>({
    queryKey: getGetWorktreeInfoQueryKey(params),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/git/worktree/info${qs(toSnakeParams(params))}` }),
    ...options,
  });
}

export function useListProjectWorktrees(
  params: ListProjectWorktreesParams,
  options?: Omit<UseQueryOptions<ProjectWorktreeInfo[], ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<ProjectWorktreeInfo[], ErrorType<unknown>>({
    queryKey: getListProjectWorktreesQueryKey(params),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/git/worktrees${qs(toSnakeParams(params))}` }),
    ...options,
  });
}

export function useGetOriginalBranch(
  params: GetOriginalBranchParams,
  options?: Omit<UseQueryOptions<OriginalBranchResponse, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<OriginalBranchResponse, ErrorType<unknown>>({
    queryKey: getGetOriginalBranchQueryKey(params),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/git/original-branch${qs(toSnakeParams(params))}` }),
    ...options,
  });
}

export function useCheckMergeConflicts(
  params: CheckMergeConflictsParams,
  options?: Omit<UseQueryOptions<MergeConflictResult, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<MergeConflictResult, ErrorType<unknown>>({
    queryKey: getCheckMergeConflictsQueryKey(params),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/git/merge-conflicts${qs(toSnakeParams(params))}` }),
    ...options,
  });
}

export function useHasUncommittedChanges(
  params: HasUncommittedChangesParams,
  options?: Omit<UseQueryOptions<HasUncommittedChangesResponse, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<HasUncommittedChangesResponse, ErrorType<unknown>>({
    queryKey: getHasUncommittedChangesQueryKey(params),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/git/has-uncommitted-changes${qs(toSnakeParams(params))}` }),
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

export function useCreateWorktree(
  options?: UseMutationOptions<CreateWorktreeResponse, ErrorType<unknown>, CreateWorktreeParams>,
) {
  return useMutation<CreateWorktreeResponse, ErrorType<unknown>, CreateWorktreeParams>({
    mutationFn: (params) =>
      customInstance({
        method: "POST",
        url: "/api/git/worktree",
        data: {
          project_id: params.projectId,
          feature_id: params.featureId,
          feature_title: params.featureTitle,
        },
      }),
    ...options,
  });
}

export function useRemoveWorktree(
  options?: UseMutationOptions<SuccessResponse, ErrorType<unknown>, RemoveWorktreeParams>,
) {
  return useMutation<SuccessResponse, ErrorType<unknown>, RemoveWorktreeParams>({
    mutationFn: (params) =>
      customInstance({
        method: "DELETE",
        url: `/api/git/worktree${qs(toSnakeParams(params))}`,
      }),
    ...options,
  });
}

export function useDeleteWorktree(
  options?: UseMutationOptions<SuccessResponse, ErrorType<unknown>, DeleteWorktreeParams>,
) {
  return useMutation<SuccessResponse, ErrorType<unknown>, DeleteWorktreeParams>({
    mutationFn: (params) =>
      customInstance({
        method: "DELETE",
        url: `/api/git/worktree/safe${qs(toSnakeParams(params))}`,
      }),
    ...options,
  });
}

export function useRetryWorktreeSetup(
  options?: UseMutationOptions<SuccessResponse, ErrorType<unknown>, RetryWorktreeParams>,
) {
  return useMutation<SuccessResponse, ErrorType<unknown>, RetryWorktreeParams>({
    mutationFn: (params) =>
      customInstance({
        method: "POST",
        url: "/api/git/worktree/retry",
        data: {
          project_id: params.projectId,
          feature_id: params.featureId,
        },
      }),
    ...options,
  });
}

export function useRemoveOrphanWorktree(
  options?: UseMutationOptions<SuccessResponse, ErrorType<unknown>, RemoveOrphanWorktreeParams>,
) {
  return useMutation<SuccessResponse, ErrorType<unknown>, RemoveOrphanWorktreeParams>({
    mutationFn: (params) =>
      customInstance({
        method: "DELETE",
        url: "/api/git/worktree/orphan",
        data: {
          project_id: params.projectId,
          worktree_path: params.worktreePath,
        },
      }),
    ...options,
  });
}

export function useMergeFeatureBranch(
  options?: UseMutationOptions<MergeResult, ErrorType<unknown>, MergeFeatureBranchParams>,
) {
  return useMutation<MergeResult, ErrorType<unknown>, MergeFeatureBranchParams>({
    mutationFn: (params) =>
      customInstance({
        method: "POST",
        url: "/api/git/merge",
        data: {
          project_id: params.projectId,
          feature_id: params.featureId,
        },
      }),
    ...options,
  });
}

export function useDeleteFeatureBranch(
  options?: UseMutationOptions<SuccessResponse, ErrorType<unknown>, DeleteFeatureBranchParams>,
) {
  return useMutation<SuccessResponse, ErrorType<unknown>, DeleteFeatureBranchParams>({
    mutationFn: (params) =>
      customInstance({
        method: "DELETE",
        url: `/api/git/branch${qs(toSnakeParams(params))}`,
      }),
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Workspace types
// ---------------------------------------------------------------------------

export interface WorkspaceSetting {
  key: string;
  value: string | null;
}

export interface WorkspaceSettingValueResponse {
  value: string | null;
}

export interface WorkspaceModelSettings {
  plan: string;
  prd: string;
  execute: string;
  risk: string;
  review: string;
  "review-fixer": string;
  session: string;
  qa: string;
  retro: string;
}

export interface WorkspaceAddPromptEntryResponse {
  success: boolean;
  skipped: boolean;
}

// ---------------------------------------------------------------------------
// Workspace query key factories
// ---------------------------------------------------------------------------

export function getListWorkspaceSettingsQueryKey() {
  return ["workspace", "settings"] as const;
}

export function getGetWorkspaceSettingQueryKey(key: string) {
  return ["workspace", "settings", key] as const;
}

export function getGetWorkspaceModelSettingsQueryKey() {
  return ["workspace", "model-settings"] as const;
}

export function getGetWorkspacePromptHistoryQueryKey(projectId: number) {
  return ["workspace", "prompt-history", projectId] as const;
}

// ---------------------------------------------------------------------------
// Workspace query hooks
// ---------------------------------------------------------------------------

export function useListWorkspaceSettings(
  options?: Omit<UseQueryOptions<WorkspaceSetting[], ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<WorkspaceSetting[], ErrorType<unknown>>({
    queryKey: getListWorkspaceSettingsQueryKey(),
    queryFn: () => customInstance({ method: "GET", url: "/api/workspace/settings" }),
    ...options,
  });
}

export function useGetWorkspaceSetting(
  key: string,
  options?: Omit<UseQueryOptions<WorkspaceSettingValueResponse, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<WorkspaceSettingValueResponse, ErrorType<unknown>>({
    queryKey: getGetWorkspaceSettingQueryKey(key),
    queryFn: () => customInstance({ method: "GET", url: `/api/workspace/settings/${encodeURIComponent(key)}` }),
    ...options,
  });
}

export function useGetWorkspaceModelSettings(
  options?: Omit<UseQueryOptions<WorkspaceModelSettings, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<WorkspaceModelSettings, ErrorType<unknown>>({
    queryKey: getGetWorkspaceModelSettingsQueryKey(),
    queryFn: () => customInstance({ method: "GET", url: "/api/workspace/model-settings" }),
    ...options,
  });
}

export function useGetWorkspacePromptHistory(
  projectId: number,
  options?: Omit<UseQueryOptions<string[], ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<string[], ErrorType<unknown>>({
    queryKey: getGetWorkspacePromptHistoryQueryKey(projectId),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/workspace/prompt-history?project_id=${projectId}` }),
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Workspace mutation hooks
// ---------------------------------------------------------------------------

export function useSetWorkspaceSetting(
  options?: UseMutationOptions<WorkspaceSettingValueResponse, ErrorType<unknown>, { key: string; value: string }>,
) {
  return useMutation<WorkspaceSettingValueResponse, ErrorType<unknown>, { key: string; value: string }>({
    mutationFn: ({ key, value }) =>
      customInstance({
        method: "PUT",
        url: `/api/workspace/settings/${encodeURIComponent(key)}`,
        data: { value },
      }),
    ...options,
  });
}

export function useSetWorkspaceModelSetting(
  options?: UseMutationOptions<WorkspaceSettingValueResponse, ErrorType<unknown>, { agentType: string; modelId: string }>,
) {
  return useMutation<WorkspaceSettingValueResponse, ErrorType<unknown>, { agentType: string; modelId: string }>({
    mutationFn: ({ agentType, modelId }) =>
      customInstance({
        method: "PUT",
        url: "/api/workspace/model-settings",
        data: { agent_type: agentType, model_id: modelId },
      }),
    ...options,
  });
}

export function useAddWorkspacePromptEntry(
  options?: UseMutationOptions<WorkspaceAddPromptEntryResponse, ErrorType<unknown>, { projectId: number; content: string }>,
) {
  return useMutation<WorkspaceAddPromptEntryResponse, ErrorType<unknown>, { projectId: number; content: string }>({
    mutationFn: ({ projectId, content }) =>
      customInstance({
        method: "POST",
        url: "/api/workspace/prompt-history",
        data: { project_id: projectId, content },
      }),
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Projects types
// ---------------------------------------------------------------------------

export interface Project {
  id: number;
  name: string;
  path: string;
  branch_prefix: string | null;
  qa_prompt: string | null;
  agent_autonomy: string | null;
  parallel_execution: number | null;
  created_at: string;
}

export interface ProjectSetting {
  key: string;
  value: string | null;
}

export interface ProjectModelSettings {
  plan: string;
  prd: string;
  execute: string;
  risk: string;
  review: string;
  "review-fixer": string;
  session: string;
  qa: string;
  retro: string;
}

// ---------------------------------------------------------------------------
// Projects query key factories
// ---------------------------------------------------------------------------

export function getListProjectsQueryKey() {
  return ["projects", "list"] as const;
}

export function getGetProjectSettingsQueryKey(projectId: number) {
  return ["projects", "settings", projectId] as const;
}

export function getGetProjectModelSettingsQueryKey(projectId: number) {
  return ["projects", "model-settings", projectId] as const;
}

// ---------------------------------------------------------------------------
// Projects query hooks
// ---------------------------------------------------------------------------

export function useListProjects(
  options?: Omit<UseQueryOptions<Project[], ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<Project[], ErrorType<unknown>>({
    queryKey: getListProjectsQueryKey(),
    queryFn: () => customInstance({ method: "GET", url: "/api/projects" }),
    ...options,
  });
}

export function useGetProjectSettings(
  projectId: number,
  options?: Omit<UseQueryOptions<ProjectSetting[], ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<ProjectSetting[], ErrorType<unknown>>({
    queryKey: getGetProjectSettingsQueryKey(projectId),
    queryFn: () => customInstance({ method: "GET", url: `/api/projects/${projectId}/settings` }),
    ...options,
  });
}

export function useGetProjectModelSettings(
  projectId: number,
  options?: Omit<UseQueryOptions<ProjectModelSettings, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<ProjectModelSettings, ErrorType<unknown>>({
    queryKey: getGetProjectModelSettingsQueryKey(projectId),
    queryFn: () => customInstance({ method: "GET", url: `/api/projects/${projectId}/model-settings` }),
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Projects mutation hooks
// ---------------------------------------------------------------------------

export function useCreateProject(
  options?: UseMutationOptions<Project, ErrorType<unknown>, { name: string; path: string }>,
) {
  return useMutation<Project, ErrorType<unknown>, { name: string; path: string }>({
    mutationFn: (body) =>
      customInstance({ method: "POST", url: "/api/projects", data: body }),
    ...options,
  });
}

export function useDeleteProject(
  options?: UseMutationOptions<{ success: boolean }, ErrorType<unknown>, { id: number }>,
) {
  return useMutation<{ success: boolean }, ErrorType<unknown>, { id: number }>({
    mutationFn: ({ id }) =>
      customInstance({ method: "DELETE", url: `/api/projects/${id}` }),
    ...options,
  });
}

export function useSetProjectSetting(
  options?: UseMutationOptions<{ success: boolean }, ErrorType<unknown>, { projectId: number; key: string; value: string }>,
) {
  return useMutation<{ success: boolean }, ErrorType<unknown>, { projectId: number; key: string; value: string }>({
    mutationFn: ({ projectId, key, value }) =>
      customInstance({
        method: "PUT",
        url: `/api/projects/${projectId}/settings`,
        data: { key, value },
      }),
    ...options,
  });
}

export function useSetProjectModelSetting(
  options?: UseMutationOptions<{ success: boolean }, ErrorType<unknown>, { projectId: number; modelType: string; model: string }>,
) {
  return useMutation<{ success: boolean }, ErrorType<unknown>, { projectId: number; modelType: string; model: string }>({
    mutationFn: ({ projectId, modelType, model }) =>
      customInstance({
        method: "PUT",
        url: `/api/projects/${projectId}/model-settings`,
        data: { model_type: modelType, model },
      }),
    ...options,
  });
}
