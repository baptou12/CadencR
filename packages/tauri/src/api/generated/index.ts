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

interface ModelInfo {
  id: string;
  label: string;
  context_window: number;
}

interface BranchResponse {
  branch: string | null;
}

interface GitStats {
  files_changed: number;
  insertions: number;
  deletions: number;
}

interface DiffResponse {
  diff: string;
}

export interface FileContent {
  old_content: string | null;
  new_content: string | null;
}

interface FileContentBatchItem {
  file_path: string;
  old_content: string | null;
  new_content: string | null;
}

interface CommitLogEntry {
  sha: string;
  short_sha: string;
  message: string;
  body: string;
  author: string;
  date: string;
  is_pushed: boolean;
}

interface CommitLogResponse {
  commits: CommitLogEntry[];
  is_on_base_branch: boolean;
}

interface FileBlobSha {
  file_path: string;
  sha: string;
}

interface ProjectWorktreeInfo {
  path: string;
  branch: string;
  head: string;
  feature_id: number | null;
  feature_title: string | null;
  feature_status: string | null;
}

interface MergeConflictResult {
  has_conflicts: boolean;
  conflict_files: string[];
}

interface MergeResult {
  success: boolean;
  error?: string;
}

interface SuccessResponse {
  success: boolean;
  error?: string;
}

interface HasUncommittedChangesResponse {
  has_changes: boolean;
}

// ---------------------------------------------------------------------------
// Request param types
// ---------------------------------------------------------------------------

interface GetBranchParams {
  projectId: number;
}

interface GetStatsParams {
  featureId: number;
  mode?: string;
  targetBranch?: string;
}

interface GetDiffParams {
  featureId: number;
  mode: string;
  commitSha?: string;
  targetBranch?: string;
}

interface GetFileContentParams {
  featureId: number;
  filePath: string;
  mode: string;
  commitSha?: string;
  targetBranch?: string;
}

interface GetFileContentBatchParams {
  featureId: number;
  filePaths: string[];
  mode: string;
  commitSha?: string;
  targetBranch?: string;
}

interface GetCommitLogParams {
  featureId: number;
  limit?: number;
}

interface GetFileBlobShasParams {
  featureId: number;
}

interface ListFilesParams {
  featureId: number;
}

interface DeleteWorktreeParams {
  projectId: number;
  featureId: number;
}

interface ListProjectWorktreesParams {
  projectId: number;
}

interface RemoveOrphanWorktreeParams {
  projectId: number;
  worktreePath: string;
}

interface CheckMergeConflictsParams {
  projectId: number;
  featureId: number;
}

interface MergeFeatureBranchParams {
  projectId: number;
  featureId: number;
}

interface DeleteFeatureBranchParams {
  projectId: number;
  featureId: number;
}

interface HasUncommittedChangesParams {
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

function getGetBranchQueryKey(params: GetBranchParams) {
  return ["git", "branch", params] as const;
}

function getGetStatsQueryKey(params: GetStatsParams) {
  return ["git", "stats", params] as const;
}

function getGetDiffQueryKey(params: GetDiffParams) {
  return ["git", "diff", params] as const;
}

export function getGetFileContentQueryKey(params: GetFileContentParams) {
  return ["git", "file-content", params] as const;
}

function getGetFileContentBatchQueryKey(params: GetFileContentBatchParams) {
  return ["git", "file-content-batch", params] as const;
}

function getGetCommitLogQueryKey(params: GetCommitLogParams) {
  return ["git", "commit-log", params] as const;
}

function getGetFileBlobShasQueryKey(params: GetFileBlobShasParams) {
  return ["git", "file-blob-shas", params] as const;
}

function getListFilesQueryKey(params: ListFilesParams) {
  return ["git", "files", params] as const;
}

export function getListProjectWorktreesQueryKey(params: ListProjectWorktreesParams) {
  return ["git", "worktrees", params] as const;
}

function getCheckMergeConflictsQueryKey(params: CheckMergeConflictsParams) {
  return ["git", "merge-conflicts", params] as const;
}

function getHasUncommittedChangesQueryKey(params: HasUncommittedChangesParams) {
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

interface WorkspaceSettingValueResponse {
  value: string | null;
}

interface WorkspaceModelSettings {
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
// Workspace query key factories
// ---------------------------------------------------------------------------

export function getGetWorkspaceSettingQueryKey(key: string) {
  return ["workspace", "settings", key] as const;
}

function getListModelsQueryKey() {
  return ["models"] as const;
}

export function getGetWorkspaceModelSettingsQueryKey() {
  return ["workspace", "model-settings"] as const;
}

// ---------------------------------------------------------------------------
// Workspace query hooks
// ---------------------------------------------------------------------------

export function useListModels(
  options?: Omit<UseQueryOptions<ModelInfo[], ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<ModelInfo[], ErrorType<unknown>>({
    queryKey: getListModelsQueryKey(),
    queryFn: () => customInstance({ method: "GET", url: "/api/models" }),
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

interface ProjectSetting {
  key: string;
  value: string | null;
}

interface ProjectModelSettings {
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

// ---------------------------------------------------------------------------
// Features types
// ---------------------------------------------------------------------------

export interface Feature {
  id: number;
  project_id: number;
  title: string;
  type: string;
  status: string;
  prd: string | null;
  workflow_step: string | null;
  workflow_config: string | null;
  model_plan: string | null;
  model_prd: string | null;
  model_execute: string | null;
  model_risk: string | null;
  model_review: string | null;
  "model_review-fixer": string | null;
  model_session: string | null;
  model_qa: string | null;
  model_retro: string | null;
  agent_autonomy: string | null;
  parallel_execution: number | null;
  created_at: string;
  workflow_definition_id: number | null;
}

interface Phase {
  id: number;
  plan_id: number;
  step_number: number;
  title: string;
  status: string;
  complexity: number | string | null;
  commit_message: string | null;
  prompt: string | null;
  phase_type: string | null;
  implementation_notes: string | null;
  deviations: string | null;
  order_index: number | null;
}

interface Plan {
  id: number;
  feature_id: number;
  title: string | null;
  status: string | null;
  summary: string | null;
  context: string | null;
  clarifications: string | null;
  completion_conditions: string | null;
  created_at: string;
}

interface PlanWithPhases extends Plan {
  phases: Phase[];
}

interface FeatureSetting {
  key: string;
  value: string;
}

interface FeatureModelSettings {
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
// Features query key helpers
// ---------------------------------------------------------------------------

export function getListFeaturesQueryKey(projectId: number) {
  return ["features", "list", projectId] as const;
}

export function getGetFeatureQueryKey(id: number) {
  return ["features", "detail", id] as const;
}

export function getGetFeaturePrdQueryKey(id: number) {
  return ["features", "prd", id] as const;
}

function getGetFeatureEmptyQueryKey(id: number) {
  return ["features", "empty", id] as const;
}

export function getGetFeaturePlanQueryKey(id: number) {
  return ["features", "plan", id] as const;
}

export function getGetFeaturePlanProgressQueryKey(id: number) {
  return ["features", "planProgress", id] as const;
}

export function getGetFeatureSettingsQueryKey(id: number) {
  return ["features", "settings", id] as const;
}

export function getGetFeatureModelSettingsQueryKey(id: number) {
  return ["features", "modelSettings", id] as const;
}

function getGetFeatureWorkingDirQueryKey(id: number, projectId: number) {
  return ["features", "workingDir", id, projectId] as const;
}

// ---------------------------------------------------------------------------
// Features query hooks
// ---------------------------------------------------------------------------

export function useListFeatures(
  projectId: number,
  options?: Omit<UseQueryOptions<Feature[], ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<Feature[], ErrorType<unknown>>({
    queryKey: getListFeaturesQueryKey(projectId),
    queryFn: () => customInstance({ method: "GET", url: `/api/features?project_id=${projectId}` }),
    ...options,
  });
}

export function useGetFeature(
  id: number,
  options?: Omit<UseQueryOptions<Feature | null, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<Feature | null, ErrorType<unknown>>({
    queryKey: getGetFeatureQueryKey(id),
    queryFn: () => customInstance({ method: "GET", url: `/api/features/${id}` }),
    ...options,
  });
}

export function useGetFeaturePrd(
  id: number,
  options?: Omit<UseQueryOptions<{ prd: string | null }, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<{ prd: string | null }, ErrorType<unknown>>({
    queryKey: getGetFeaturePrdQueryKey(id),
    queryFn: () => customInstance({ method: "GET", url: `/api/features/${id}/prd` }),
    ...options,
  });
}

export function useGetFeatureEmpty(
  id: number,
  options?: Omit<UseQueryOptions<{ empty: boolean }, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<{ empty: boolean }, ErrorType<unknown>>({
    queryKey: getGetFeatureEmptyQueryKey(id),
    queryFn: () => customInstance({ method: "GET", url: `/api/features/${id}/empty` }),
    ...options,
  });
}

export function useGetFeaturePlan(
  id: number,
  options?: Omit<UseQueryOptions<PlanWithPhases | null, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<PlanWithPhases | null, ErrorType<unknown>>({
    queryKey: getGetFeaturePlanQueryKey(id),
    queryFn: () => customInstance({ method: "GET", url: `/api/features/${id}/plan` }),
    ...options,
  });
}

export function useGetFeatureSettings(
  id: number,
  options?: Omit<UseQueryOptions<FeatureSetting[], ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<FeatureSetting[], ErrorType<unknown>>({
    queryKey: getGetFeatureSettingsQueryKey(id),
    queryFn: () => customInstance({ method: "GET", url: `/api/features/${id}/settings` }),
    ...options,
  });
}

export function useGetFeatureModelSettings(
  id: number,
  options?: Omit<UseQueryOptions<FeatureModelSettings, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<FeatureModelSettings, ErrorType<unknown>>({
    queryKey: getGetFeatureModelSettingsQueryKey(id),
    queryFn: () => customInstance({ method: "GET", url: `/api/features/${id}/model-settings` }),
    ...options,
  });
}

export function useGetFeatureWorkingDir(
  id: number,
  projectId: number,
  options?: Omit<UseQueryOptions<{ path: string | null }, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<{ path: string | null }, ErrorType<unknown>>({
    queryKey: getGetFeatureWorkingDirQueryKey(id, projectId),
    queryFn: () => customInstance({ method: "GET", url: `/api/features/${id}/working-dir?project_id=${projectId}` }),
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Features mutation hooks
// ---------------------------------------------------------------------------

export function useCreateFeature(
  options?: UseMutationOptions<{ id: number }, ErrorType<unknown>, { project_id: number; title?: string; type?: string; workflow_definition_id?: number | null }>,
) {
  return useMutation<{ id: number }, ErrorType<unknown>, { project_id: number; title?: string; type?: string; workflow_definition_id?: number | null }>({
    mutationFn: (body) => customInstance({ method: "POST", url: "/api/features", data: body }),
    ...options,
  });
}

export function useDeleteFeature(
  options?: UseMutationOptions<{ success: boolean }, ErrorType<unknown>, { id: number }>,
) {
  return useMutation<{ success: boolean }, ErrorType<unknown>, { id: number }>({
    mutationFn: ({ id }) => customInstance({ method: "DELETE", url: `/api/features/${id}` }),
    ...options,
  });
}

export function useUpdateFeatureStatus(
  options?: UseMutationOptions<{ success: boolean }, ErrorType<unknown>, { id: number; status: string }>,
) {
  return useMutation<{ success: boolean }, ErrorType<unknown>, { id: number; status: string }>({
    mutationFn: ({ id, status }) =>
      customInstance({ method: "PUT", url: `/api/features/${id}/status`, data: { status } }),
    ...options,
  });
}

export function useSetFeatureSetting(
  options?: UseMutationOptions<{ success: boolean }, ErrorType<unknown>, { featureId: number; key: string; value: string }>,
) {
  return useMutation<{ success: boolean }, ErrorType<unknown>, { featureId: number; key: string; value: string }>({
    mutationFn: ({ featureId, key, value }) =>
      customInstance({ method: "PUT", url: `/api/features/${featureId}/settings`, data: { key, value } }),
    ...options,
  });
}

export function useSetFeatureModelSetting(
  options?: UseMutationOptions<{ success: boolean }, ErrorType<unknown>, { featureId: number; modelType: string; model: string }>,
) {
  return useMutation<{ success: boolean }, ErrorType<unknown>, { featureId: number; modelType: string; model: string }>({
    mutationFn: ({ featureId, modelType, model }) =>
      customInstance({
        method: "PUT",
        url: `/api/features/${featureId}/model-settings`,
        data: { model_type: modelType, model },
      }),
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Diff Comments
// ---------------------------------------------------------------------------

interface DiffComment {
  id: number;
  feature_id: number;
  file_path: string;
  line_number: number;
  side: string;
  content: string;
  status: string;
  created_at: string;
}

interface DiffViewedFile {
  id: number;
  feature_id: number;
  file_path: string;
  blob_sha: string;
  viewed_at: string;
}

export function useListDiffComments(
  featureId: number,
  options?: UseQueryOptions<DiffComment[], ErrorType<unknown>>,
) {
  return useQuery<DiffComment[], ErrorType<unknown>>({
    queryKey: ["diff-comments", featureId],
    queryFn: () => customInstance({ method: "GET", url: `/api/features/${featureId}/diff-comments` }),
    ...options,
  });
}

export function useCreateDiffComment(
  options?: UseMutationOptions<DiffComment, ErrorType<unknown>, { featureId: number; filePath: string; lineNumber: number; side: string; content: string }>,
) {
  return useMutation<DiffComment, ErrorType<unknown>, { featureId: number; filePath: string; lineNumber: number; side: string; content: string }>({
    mutationFn: ({ featureId, filePath, lineNumber, side, content }) =>
      customInstance({ method: "POST", url: `/api/features/${featureId}/diff-comments`, data: { feature_id: featureId, file_path: filePath, line_number: lineNumber, side, content } }),
    ...options,
  });
}

export function useUpdateDiffComment(
  options?: UseMutationOptions<{ success: boolean }, ErrorType<unknown>, { id: number; content: string }>,
) {
  return useMutation<{ success: boolean }, ErrorType<unknown>, { id: number; content: string }>({
    mutationFn: ({ id, content }) =>
      customInstance({ method: "PUT", url: `/api/diff-comments/${id}`, data: { content } }),
    ...options,
  });
}

export function useDeleteDiffComment(
  options?: UseMutationOptions<{ success: boolean }, ErrorType<unknown>, { id: number }>,
) {
  return useMutation<{ success: boolean }, ErrorType<unknown>, { id: number }>({
    mutationFn: ({ id }) =>
      customInstance({ method: "DELETE", url: `/api/diff-comments/${id}` }),
    ...options,
  });
}

export function useDeletePendingDiffComments(
  options?: UseMutationOptions<{ deleted: number }, ErrorType<unknown>, { featureId: number }>,
) {
  return useMutation<{ deleted: number }, ErrorType<unknown>, { featureId: number }>({
    mutationFn: ({ featureId }) =>
      customInstance({ method: "DELETE", url: `/api/features/${featureId}/diff-comments/pending` }),
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Diff Viewed
// ---------------------------------------------------------------------------

export function useListDiffViewed(
  featureId: number,
  options?: UseQueryOptions<DiffViewedFile[], ErrorType<unknown>>,
) {
  return useQuery<DiffViewedFile[], ErrorType<unknown>>({
    queryKey: ["diff-viewed", featureId],
    queryFn: () => customInstance({ method: "GET", url: `/api/features/${featureId}/diff-viewed` }),
    ...options,
  });
}

export function useMarkDiffViewed(
  options?: UseMutationOptions<{ success: boolean }, ErrorType<unknown>, { featureId: number; filePath: string; blobSha: string }>,
) {
  return useMutation<{ success: boolean }, ErrorType<unknown>, { featureId: number; filePath: string; blobSha: string }>({
    mutationFn: ({ featureId, filePath, blobSha }) =>
      customInstance({ method: "POST", url: `/api/features/${featureId}/diff-viewed`, data: { feature_id: featureId, file_path: filePath, blob_sha: blobSha } }),
    ...options,
  });
}

export function useUnmarkDiffViewed(
  options?: UseMutationOptions<{ success: boolean }, ErrorType<unknown>, { featureId: number; filePath: string }>,
) {
  return useMutation<{ success: boolean }, ErrorType<unknown>, { featureId: number; filePath: string }>({
    mutationFn: ({ featureId, filePath }) =>
      customInstance({
        method: "DELETE",
        url: `/api/features/${featureId}/diff-viewed/file`,
        params: { file_path: filePath },
      }),
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Sessions — types
// ---------------------------------------------------------------------------

export interface AgentBlock {
  id: string;
  type: string;
  content: string;
  toolName?: string;
  toolArgs?: string;
  isError?: boolean;
  toolUseId?: string;
  parentToolUseId?: string | null;
  childBlocks?: AgentBlock[];
  sourceToolName?: string;
  createdAt?: string;
  model?: string;
}

export interface SessionState {
  sessionDbId: number;
  agentType: string;
  status: string;
  subprocessId: string | null;
  model: string | null;
  blocks: AgentBlock[];
  maxMessageId: number;
  isIncremental: boolean;
  toolCallUpdates?: Record<string, string> | null;
  pendingQuestions: unknown | null;
  hasFileChanges: boolean;
  resumable: boolean;
  claudeSessionId: string | null;
  runId: number | null;
  phaseId: number | null;
  phaseTitle: string | null;
  todos: Array<{ content: string; status: string; activeForm: string }> | null;
  permissionMode: string;
  pendingPlanApproval: unknown | null;
  pendingPrdApproval: unknown | null;
  pendingPermission: unknown | null;
  inputTokens: number;
  outputTokens: number;
  contextWindow: number;
  wasCompacted: boolean;
  draftPrompt: string | null;
  hasMore: boolean;
  oldestMessageId: number | null;
}

export interface FeatureAgentStateResponse {
  sessions: SessionState[];
}

interface DraftResponse {
  draftPrompt: string | null;
}

// ---------------------------------------------------------------------------
// Sessions — query key factories
// ---------------------------------------------------------------------------

function getGetFeatureAgentStateQueryKey(featureId: number, after?: string, limit?: number, before?: string) {
  return ["sessions", "agentState", featureId, after, limit, before] as const;
}

function getGetSessionDraftQueryKey(sessionId: number) {
  return ["sessions", "draft", sessionId] as const;
}

// ---------------------------------------------------------------------------
// Sessions — hooks
// ---------------------------------------------------------------------------

export function useGetFeatureAgentState(
  featureId: number,
  after?: string,
  options?: Omit<UseQueryOptions<FeatureAgentStateResponse, ErrorType<unknown>>, "queryKey" | "queryFn">,
  limit?: number,
) {
  return useQuery<FeatureAgentStateResponse, ErrorType<unknown>>({
    queryKey: getGetFeatureAgentStateQueryKey(featureId, after, limit),
    queryFn: () =>
      customInstance({
        method: "GET",
        url: `/api/features/${featureId}/agent-state`,
        params: {
          ...(after ? { after } : undefined),
          ...(limit ? { limit } : undefined),
        },
      }),
    ...options,
  });
}

export function fetchFeatureAgentState(
  featureId: number,
  params: { before?: string; limit?: number },
): Promise<FeatureAgentStateResponse> {
  return customInstance({
    method: "GET",
    url: `/api/features/${featureId}/agent-state`,
    params: {
      ...(params.before ? { before: params.before } : undefined),
      ...(params.limit ? { limit: params.limit } : undefined),
    },
  });
}

export function useGetSessionDraft(
  sessionId: number,
  options?: Omit<UseQueryOptions<DraftResponse, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<DraftResponse, ErrorType<unknown>>({
    queryKey: getGetSessionDraftQueryKey(sessionId),
    queryFn: () => customInstance({ method: "GET", url: `/api/sessions/${sessionId}/draft` }),
    ...options,
  });
}

export function useSaveSessionDraft(
  options?: UseMutationOptions<{ success: boolean }, ErrorType<unknown>, { sessionId: number; draft: string | null }>,
) {
  return useMutation<{ success: boolean }, ErrorType<unknown>, { sessionId: number; draft: string | null }>({
    mutationFn: ({ sessionId, draft }) =>
      customInstance({ method: "PUT", url: `/api/sessions/${sessionId}/draft`, data: { draft } }),
    ...options,
  });
}

type ExternalApp = "terminal" | "zed";

interface OpenExternalRequest {
  app: ExternalApp;
}

interface OpenExternalResponse {
  success: boolean;
}

export function useOpenExternalHandler(
  options?: UseMutationOptions<OpenExternalResponse, ErrorType<unknown>, { id: number; data: OpenExternalRequest }>,
) {
  return useMutation<OpenExternalResponse, ErrorType<unknown>, { id: number; data: OpenExternalRequest }>({
    mutationFn: ({ id, data }) =>
      customInstance({ method: "POST", url: `/api/features/${id}/open-external`, data }),
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

interface UsageBucket {
  utilization: number;
  resets_at: string | null;
}

type UsageStatus = "success" | "cached" | "rate_limited" | "error";

interface UsageResponse {
  five_hour: UsageBucket | null;
  seven_day: UsageBucket | null;
  seven_day_sonnet: UsageBucket | null;
  status: UsageStatus;
  status_message: string | null;
  retry_at: number | null;
  updated_at: number;
}

const getGetUsageHandlerQueryKey = () => ["getUsageHandler"] as const;

export function useGetUsageHandler(
  options?: { query?: Omit<UseQueryOptions<UsageResponse, ErrorType<unknown>>, "queryKey" | "queryFn"> },
) {
  return useQuery<UsageResponse, ErrorType<unknown>>({
    queryKey: getGetUsageHandlerQueryKey(),
    queryFn: () => customInstance({ method: "GET", url: "/api/usage" }),
    ...options?.query,
  });
}

// ---------------------------------------------------------------------------
// Editor — file read/write/tree
// ---------------------------------------------------------------------------

interface FileReadResponse {
  content: string;
  line_count: number;
}

interface FileWriteRequest {
  project_path: string;
  file_path: string;
  content: string;
}

interface FileWriteResponse {
  success: boolean;
}

export interface FileTreeEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_gitignored: boolean;
}

interface ReadFileParams {
  projectPath: string;
  filePath: string;
}

interface FileTreeParams {
  projectPath: string;
  dirPath: string;
}

function getReadFileQueryKey(params: ReadFileParams) {
  return ["editor", "read", params] as const;
}

function getFileTreeQueryKey(params: FileTreeParams) {
  return ["editor", "tree", params] as const;
}

export function useReadFile(
  params: ReadFileParams,
  options?: Omit<UseQueryOptions<FileReadResponse, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<FileReadResponse, ErrorType<unknown>>({
    queryKey: getReadFileQueryKey(params),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/editor/read${qs(toSnakeParams(params))}` }),
    ...options,
  });
}

export function useFileTree(
  params: FileTreeParams,
  options?: Omit<UseQueryOptions<FileTreeEntry[], ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<FileTreeEntry[], ErrorType<unknown>>({
    queryKey: getFileTreeQueryKey(params),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/editor/tree${qs(toSnakeParams(params))}` }),
    ...options,
  });
}

export interface FileMatchResult {
  path: string;
  positions: number[];
}

interface FileSearchResponse {
  files: FileMatchResult[];
}

function getFileSearchQueryKey(projectPath: string, query?: string) {
  return ["editor", "search", projectPath, query ?? ""] as const;
}

export function useFileSearch(
  projectPath: string,
  query?: string,
  options?: Omit<UseQueryOptions<FileSearchResponse, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  const queryParam = query ? `&query=${encodeURIComponent(query)}` : "";
  return useQuery<FileSearchResponse, ErrorType<unknown>>({
    queryKey: getFileSearchQueryKey(projectPath, query),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/editor/search?project_path=${encodeURIComponent(projectPath)}${queryParam}` }),
    ...options,
  });
}

export function useWriteFile(
  options?: UseMutationOptions<FileWriteResponse, ErrorType<unknown>, FileWriteRequest>,
) {
  return useMutation<FileWriteResponse, ErrorType<unknown>, FileWriteRequest>({
    mutationFn: (params) =>
      customInstance({
        method: "POST",
        url: "/api/editor/write",
        data: params,
      }),
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Workflow Definition types
// ---------------------------------------------------------------------------

export interface WorkflowPhase {
  id: number;
  workflow_definition_id: number;
  name: string;
  slug: string;
  order_index: number;
  gate_type: "auto" | "approval" | "manual" | "iterate";
  system_prompt_template: string;
  command_prompt_template: string;
  artifact_template: string;
  input_phase_slugs: string[];
  model_override: string;
  agent_type: "workflow" | "execute";
  artifact_types: string[];
  max_iterations: number;
}

export interface WorkflowDefinition {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  is_preset: boolean;
  phases: WorkflowPhase[];
  created_at: string;
  updated_at: string;
}

export const DEFAULT_ARTIFACT_TYPE = "default";

interface WorkflowArtifact {
  id: number;
  feature_id: number;
  phase_slug: string;
  artifact_type: string;
  content: string;
  agent_session_id: number | null;
  created_at: string;
  updated_at: string;
}

interface CreateWorkflowDefinition {
  name: string;
  slug: string;
  description?: string;
  phases: Omit<WorkflowPhase, "id" | "workflow_definition_id">[];
}

interface UpdateWorkflowDefinition {
  name?: string;
  slug?: string;
  description?: string;
}

interface CreateWorkflowPhaseParams {
  definitionId: number;
  phase: Omit<WorkflowPhase, "id" | "workflow_definition_id">;
}

interface UpdateWorkflowPhaseParams {
  definitionId: number;
  phaseId: number;
  phase: Partial<Omit<WorkflowPhase, "id" | "workflow_definition_id">>;
}

interface DeleteWorkflowPhaseParams {
  definitionId: number;
  phaseId: number;
}

interface ReorderWorkflowPhasesParams {
  definitionId: number;
  phase_ids: number[];
}

interface UpdateFeatureArtifactParams {
  featureId: number;
  phaseSlug: string;
  content: string;
}

interface UpdateTypedArtifactParams {
  featureId: number;
  phaseSlug: string;
  artifactType: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Workflow query key factories
// ---------------------------------------------------------------------------

export function getListWorkflowDefinitionsQueryKey() {
  return ["workflow", "definitions"] as const;
}

export function getGetWorkflowDefinitionQueryKey(id: number) {
  return ["workflow", "definitions", id] as const;
}

function getGetFeatureArtifactQueryKey(featureId: number, phaseSlug: string) {
  return ["workflow", "artifacts", featureId, phaseSlug] as const;
}

function getGetTypedArtifactQueryKey(featureId: number, phaseSlug: string, artifactType: string) {
  return ["workflow", "artifacts", featureId, phaseSlug, "types", artifactType] as const;
}

// ---------------------------------------------------------------------------
// Workflow query hooks
// ---------------------------------------------------------------------------

export function useListWorkflowDefinitions(
  options?: Omit<UseQueryOptions<WorkflowDefinition[], ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<WorkflowDefinition[], ErrorType<unknown>>({
    queryKey: getListWorkflowDefinitionsQueryKey(),
    queryFn: () =>
      customInstance({ method: "GET", url: "/api/workflow-definitions" }),
    ...options,
  });
}

export function useGetWorkflowDefinition(
  id: number,
  options?: Omit<UseQueryOptions<WorkflowDefinition, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<WorkflowDefinition, ErrorType<unknown>>({
    queryKey: getGetWorkflowDefinitionQueryKey(id),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/workflow-definitions/${id}` }),
    ...options,
  });
}

export function useGetFeatureArtifact(
  featureId: number,
  phaseSlug: string,
  options?: Omit<UseQueryOptions<WorkflowArtifact, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<WorkflowArtifact, ErrorType<unknown>>({
    queryKey: getGetFeatureArtifactQueryKey(featureId, phaseSlug),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/features/${featureId}/artifacts/${phaseSlug}` }),
    ...options,
  });
}

export function useGetTypedArtifact(
  featureId: number,
  phaseSlug: string,
  artifactType: string,
  options?: Omit<UseQueryOptions<WorkflowArtifact, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<WorkflowArtifact, ErrorType<unknown>>({
    queryKey: getGetTypedArtifactQueryKey(featureId, phaseSlug, artifactType),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/features/${featureId}/artifacts/${phaseSlug}/types/${artifactType}` }),
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Workflow mutation hooks
// ---------------------------------------------------------------------------

export function useCreateWorkflowDefinition(
  options?: UseMutationOptions<WorkflowDefinition, ErrorType<unknown>, CreateWorkflowDefinition>,
) {
  return useMutation<WorkflowDefinition, ErrorType<unknown>, CreateWorkflowDefinition>({
    mutationFn: (params) =>
      customInstance({
        method: "POST",
        url: "/api/workflow-definitions",
        data: params,
      }),
    ...options,
  });
}

export function useUpdateWorkflowDefinition(
  options?: UseMutationOptions<WorkflowDefinition, ErrorType<unknown>, { id: number; data: UpdateWorkflowDefinition }>,
) {
  return useMutation<WorkflowDefinition, ErrorType<unknown>, { id: number; data: UpdateWorkflowDefinition }>({
    mutationFn: (params) =>
      customInstance({
        method: "PUT",
        url: `/api/workflow-definitions/${params.id}`,
        data: params.data,
      }),
    ...options,
  });
}

export function useDeleteWorkflowDefinition(
  options?: UseMutationOptions<SuccessResponse, ErrorType<unknown>, number>,
) {
  return useMutation<SuccessResponse, ErrorType<unknown>, number>({
    mutationFn: (id) =>
      customInstance({
        method: "DELETE",
        url: `/api/workflow-definitions/${id}`,
      }),
    ...options,
  });
}

export function useForkWorkflowDefinition(
  options?: UseMutationOptions<WorkflowDefinition, ErrorType<unknown>, { id: number; name: string; slug: string }>,
) {
  return useMutation<WorkflowDefinition, ErrorType<unknown>, { id: number; name: string; slug: string }>({
    mutationFn: (params) =>
      customInstance({
        method: "POST",
        url: `/api/workflow-definitions/${params.id}/fork`,
        data: { new_name: params.name, new_slug: params.slug },
      }),
    ...options,
  });
}

export function useCreateWorkflowPhase(
  options?: UseMutationOptions<WorkflowPhase, ErrorType<unknown>, CreateWorkflowPhaseParams>,
) {
  return useMutation<WorkflowPhase, ErrorType<unknown>, CreateWorkflowPhaseParams>({
    mutationFn: (params) =>
      customInstance({
        method: "POST",
        url: `/api/workflow-definitions/${params.definitionId}/phases`,
        data: params.phase,
      }),
    ...options,
  });
}

export function useUpdateWorkflowPhase(
  options?: UseMutationOptions<WorkflowPhase, ErrorType<unknown>, UpdateWorkflowPhaseParams>,
) {
  return useMutation<WorkflowPhase, ErrorType<unknown>, UpdateWorkflowPhaseParams>({
    mutationFn: (params) =>
      customInstance({
        method: "PUT",
        url: `/api/workflow-definitions/${params.definitionId}/phases/${params.phaseId}`,
        data: params.phase,
      }),
    ...options,
  });
}

export function useDeleteWorkflowPhase(
  options?: UseMutationOptions<SuccessResponse, ErrorType<unknown>, DeleteWorkflowPhaseParams>,
) {
  return useMutation<SuccessResponse, ErrorType<unknown>, DeleteWorkflowPhaseParams>({
    mutationFn: (params) =>
      customInstance({
        method: "DELETE",
        url: `/api/workflow-definitions/${params.definitionId}/phases/${params.phaseId}`,
      }),
    ...options,
  });
}

export function useReorderWorkflowPhases(
  options?: UseMutationOptions<SuccessResponse, ErrorType<unknown>, ReorderWorkflowPhasesParams>,
) {
  return useMutation<SuccessResponse, ErrorType<unknown>, ReorderWorkflowPhasesParams>({
    mutationFn: (params) =>
      customInstance({
        method: "PUT",
        url: `/api/workflow-definitions/${params.definitionId}/phases/reorder`,
        data: { phase_ids: params.phase_ids },
      }),
    ...options,
  });
}

export function useUpdateFeatureArtifact(
  options?: UseMutationOptions<WorkflowArtifact, ErrorType<unknown>, UpdateFeatureArtifactParams>,
) {
  return useMutation<WorkflowArtifact, ErrorType<unknown>, UpdateFeatureArtifactParams>({
    mutationFn: (params) =>
      customInstance({
        method: "PUT",
        url: `/api/features/${params.featureId}/artifacts/${params.phaseSlug}`,
        data: { content: params.content },
      }),
    ...options,
  });
}

export function useUpdateTypedArtifact(
  options?: UseMutationOptions<WorkflowArtifact, ErrorType<unknown>, UpdateTypedArtifactParams>,
) {
  return useMutation<WorkflowArtifact, ErrorType<unknown>, UpdateTypedArtifactParams>({
    mutationFn: (params) =>
      customInstance({
        method: "PUT",
        url: `/api/features/${params.featureId}/artifacts/${params.phaseSlug}/types/${params.artifactType}`,
        data: { content: params.content },
      }),
    ...options,
  });
}
