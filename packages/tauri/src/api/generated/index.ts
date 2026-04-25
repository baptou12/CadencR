/**
 * Generated-style React Query v4 hooks for the Rust git backend.
 *
 * These hooks mirror the output that `orval` would produce from the Rust
 * OpenAPI spec.  Run `pnpm generate:api` to regenerate once the Rust
 * backend is running.
 */

import {
  useQuery,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { customInstance, type ErrorType } from "../client";

// ---------------------------------------------------------------------------
// Types — match the Rust models (snake_case JSON)
// ---------------------------------------------------------------------------

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

export interface FeatureWorktreeInfo {
  feature_id: number;
  worktree_path: string;
  worktree_branch: string | null;
  /** Whether the worktree directory currently exists on disk. */
  live: boolean;
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

export interface BlameLine {
  line: number;
  author: string;
  date: string;
  summary: string;
}

interface BlameResponse {
  lines: BlameLine[];
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

interface ListFeatureWorktreesParams {
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

interface GetBlameParams {
  projectId: number;
  featureId?: number;
  filePath: string;
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

export function getListFeatureWorktreesQueryKey(params: ListFeatureWorktreesParams) {
  return ["git", "feature-worktrees", params] as const;
}

function getCheckMergeConflictsQueryKey(params: CheckMergeConflictsParams) {
  return ["git", "merge-conflicts", params] as const;
}

function getHasUncommittedChangesQueryKey(params: HasUncommittedChangesParams) {
  return ["git", "has-uncommitted-changes", params] as const;
}

function getGetBlameQueryKey(params: GetBlameParams) {
  return ["git", "blame", params] as const;
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
  options?: Omit<
    UseQueryOptions<FileContentBatchItem[], ErrorType<unknown>>,
    "queryKey" | "queryFn"
  >,
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
  options?: Omit<
    UseQueryOptions<ProjectWorktreeInfo[], ErrorType<unknown>>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery<ProjectWorktreeInfo[], ErrorType<unknown>>({
    queryKey: getListProjectWorktreesQueryKey(params),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/git/worktrees${qs(toSnakeParams(params))}` }),
    ...options,
  });
}

export function useListFeatureWorktrees(
  params: ListFeatureWorktreesParams,
  options?: Omit<
    UseQueryOptions<FeatureWorktreeInfo[], ErrorType<unknown>>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery<FeatureWorktreeInfo[], ErrorType<unknown>>({
    queryKey: getListFeatureWorktreesQueryKey(params),
    queryFn: () =>
      customInstance({
        method: "GET",
        url: `/api/git/feature-worktrees${qs(toSnakeParams(params))}`,
      }),
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
      customInstance({
        method: "GET",
        url: `/api/git/merge-conflicts${qs(toSnakeParams(params))}`,
      }),
    ...options,
  });
}

export function useHasUncommittedChanges(
  params: HasUncommittedChangesParams,
  options?: Omit<
    UseQueryOptions<HasUncommittedChangesResponse, ErrorType<unknown>>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery<HasUncommittedChangesResponse, ErrorType<unknown>>({
    queryKey: getHasUncommittedChangesQueryKey(params),
    queryFn: () =>
      customInstance({
        method: "GET",
        url: `/api/git/has-uncommitted-changes${qs(toSnakeParams(params))}`,
      }),
    ...options,
  });
}

export function useGetBlame(
  params: GetBlameParams,
  options?: Omit<UseQueryOptions<BlameResponse, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<BlameResponse, ErrorType<unknown>>({
    queryKey: getGetBlameQueryKey(params),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/git/blame${qs(toSnakeParams(params))}` }),
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
  auto_name: string;
}

// ---------------------------------------------------------------------------
// Workspace query key factories
// ---------------------------------------------------------------------------

export function getGetWorkspaceSettingQueryKey(key: string) {
  return ["workspace", "settings", key] as const;
}

export function getGetWorkspaceModelSettingsQueryKey() {
  return ["workspace", "model-settings"] as const;
}

// ---------------------------------------------------------------------------
// Workspace query hooks
// ---------------------------------------------------------------------------

export function useGetWorkspaceSetting(
  key: string,
  options?: Omit<
    UseQueryOptions<WorkspaceSettingValueResponse, ErrorType<unknown>>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery<WorkspaceSettingValueResponse, ErrorType<unknown>>({
    queryKey: getGetWorkspaceSettingQueryKey(key),
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/workspace/settings/${encodeURIComponent(key)}` }),
    ...options,
  });
}

export function useGetWorkspaceModelSettings(
  options?: Omit<
    UseQueryOptions<WorkspaceModelSettings, ErrorType<unknown>>,
    "queryKey" | "queryFn"
  >,
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
  options?: UseMutationOptions<
    WorkspaceSettingValueResponse,
    ErrorType<unknown>,
    { key: string; value: string }
  >,
) {
  return useMutation<
    WorkspaceSettingValueResponse,
    ErrorType<unknown>,
    { key: string; value: string }
  >({
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
  options?: UseMutationOptions<
    WorkspaceSettingValueResponse,
    ErrorType<unknown>,
    { agentType: string; modelId: string }
  >,
) {
  return useMutation<
    WorkspaceSettingValueResponse,
    ErrorType<unknown>,
    { agentType: string; modelId: string }
  >({
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
  auto_name: string;
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
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/projects/${projectId}/model-settings` }),
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
    mutationFn: (body) => customInstance({ method: "POST", url: "/api/projects", data: body }),
    ...options,
  });
}

export function useDeleteProject(
  options?: UseMutationOptions<{ success: boolean }, ErrorType<unknown>, { id: number }>,
) {
  return useMutation<{ success: boolean }, ErrorType<unknown>, { id: number }>({
    mutationFn: ({ id }) => customInstance({ method: "DELETE", url: `/api/projects/${id}` }),
    ...options,
  });
}

export function useSetProjectSetting(
  options?: UseMutationOptions<
    { success: boolean },
    ErrorType<unknown>,
    { projectId: number; key: string; value: string }
  >,
) {
  return useMutation<
    { success: boolean },
    ErrorType<unknown>,
    { projectId: number; key: string; value: string }
  >({
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
  options?: UseMutationOptions<
    { success: boolean },
    ErrorType<unknown>,
    { projectId: number; modelType: string; model: string }
  >,
) {
  return useMutation<
    { success: boolean },
    ErrorType<unknown>,
    { projectId: number; modelType: string; model: string }
  >({
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
  auto_name: string;
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
  options?: Omit<
    UseQueryOptions<{ prd: string | null }, ErrorType<unknown>>,
    "queryKey" | "queryFn"
  >,
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
  options?: Omit<
    UseQueryOptions<PlanWithPhases | null, ErrorType<unknown>>,
    "queryKey" | "queryFn"
  >,
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
  options?: Omit<
    UseQueryOptions<{ path: string | null }, ErrorType<unknown>>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery<{ path: string | null }, ErrorType<unknown>>({
    queryKey: getGetFeatureWorkingDirQueryKey(id, projectId),
    queryFn: () =>
      customInstance({
        method: "GET",
        url: `/api/features/${id}/working-dir?project_id=${projectId}`,
      }),
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Features mutation hooks
// ---------------------------------------------------------------------------

export function useCreateFeature(
  options?: UseMutationOptions<
    { id: number },
    ErrorType<unknown>,
    { project_id: number; title?: string; type?: string }
  >,
) {
  return useMutation<
    { id: number },
    ErrorType<unknown>,
    { project_id: number; title?: string; type?: string }
  >({
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
  options?: UseMutationOptions<
    { success: boolean },
    ErrorType<unknown>,
    { id: number; status: string }
  >,
) {
  return useMutation<{ success: boolean }, ErrorType<unknown>, { id: number; status: string }>({
    mutationFn: ({ id, status }) =>
      customInstance({ method: "PUT", url: `/api/features/${id}/status`, data: { status } }),
    ...options,
  });
}

export function useSetFeatureSetting(
  options?: UseMutationOptions<
    { success: boolean },
    ErrorType<unknown>,
    { featureId: number; key: string; value: string }
  >,
) {
  return useMutation<
    { success: boolean },
    ErrorType<unknown>,
    { featureId: number; key: string; value: string }
  >({
    mutationFn: ({ featureId, key, value }) =>
      customInstance({
        method: "PUT",
        url: `/api/features/${featureId}/settings`,
        data: { key, value },
      }),
    ...options,
  });
}

export function useSetFeatureModelSetting(
  options?: UseMutationOptions<
    { success: boolean },
    ErrorType<unknown>,
    { featureId: number; modelType: string; model: string }
  >,
) {
  return useMutation<
    { success: boolean },
    ErrorType<unknown>,
    { featureId: number; modelType: string; model: string }
  >({
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
    queryFn: () =>
      customInstance({ method: "GET", url: `/api/features/${featureId}/diff-comments` }),
    ...options,
  });
}

export function useCreateDiffComment(
  options?: UseMutationOptions<
    DiffComment,
    ErrorType<unknown>,
    { featureId: number; filePath: string; lineNumber: number; side: string; content: string }
  >,
) {
  return useMutation<
    DiffComment,
    ErrorType<unknown>,
    { featureId: number; filePath: string; lineNumber: number; side: string; content: string }
  >({
    mutationFn: ({ featureId, filePath, lineNumber, side, content }) =>
      customInstance({
        method: "POST",
        url: `/api/features/${featureId}/diff-comments`,
        data: {
          feature_id: featureId,
          file_path: filePath,
          line_number: lineNumber,
          side,
          content,
        },
      }),
    ...options,
  });
}

export function useUpdateDiffComment(
  options?: UseMutationOptions<
    { success: boolean },
    ErrorType<unknown>,
    { id: number; content: string }
  >,
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
    mutationFn: ({ id }) => customInstance({ method: "DELETE", url: `/api/diff-comments/${id}` }),
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
  options?: UseMutationOptions<
    { success: boolean },
    ErrorType<unknown>,
    { featureId: number; filePath: string; blobSha: string }
  >,
) {
  return useMutation<
    { success: boolean },
    ErrorType<unknown>,
    { featureId: number; filePath: string; blobSha: string }
  >({
    mutationFn: ({ featureId, filePath, blobSha }) =>
      customInstance({
        method: "POST",
        url: `/api/features/${featureId}/diff-viewed`,
        data: { feature_id: featureId, file_path: filePath, blob_sha: blobSha },
      }),
    ...options,
  });
}

export function useUnmarkDiffViewed(
  options?: UseMutationOptions<
    { success: boolean },
    ErrorType<unknown>,
    { featureId: number; filePath: string }
  >,
) {
  return useMutation<
    { success: boolean },
    ErrorType<unknown>,
    { featureId: number; filePath: string }
  >({
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
  runtimeProvider?: string | null;
  runtimeSessionId: string | null;
  runId: number | null;
  phaseId: number | null;
  phaseTitle: string | null;
  todos: Array<{ content: string; status: string; activeForm: string }> | null;
  permissionMode: string;
  pendingPlanApproval: { plan?: string } | null;
  pendingPrdApproval: unknown | null;
  pendingPermission: unknown | null;
  inputTokens: number;
  outputTokens: number;
  /** `null` when the provider hasn't reported an authoritative window yet. */
  contextWindow: number | null;
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

function getGetFeatureAgentStateQueryKey(
  featureId: number,
  after?: string,
  limit?: number,
  before?: string,
) {
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
  options?: Omit<
    UseQueryOptions<FeatureAgentStateResponse, ErrorType<unknown>>,
    "queryKey" | "queryFn"
  >,
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
  options?: UseMutationOptions<
    { success: boolean },
    ErrorType<unknown>,
    { sessionId: number; draft: string | null }
  >,
) {
  return useMutation<
    { success: boolean },
    ErrorType<unknown>,
    { sessionId: number; draft: string | null }
  >({
    mutationFn: ({ sessionId, draft }) =>
      customInstance({ method: "PUT", url: `/api/sessions/${sessionId}/draft`, data: { draft } }),
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Custom Actions — user-defined header buttons (replace Open in Zed/Terminal).
// ---------------------------------------------------------------------------

export type CustomActionScope = "global" | "project";

export interface CustomActionLastRunSummary {
  exit_code: number | null;
  ended_at: string | null;
}

export interface CustomAction {
  id: number;
  name: string;
  command: string;
  icon_data: string | null;
  scope: CustomActionScope;
  project_id: number | null;
  position: number;
  created_at: string;
  updated_at: string;
  /** `${VAR}` placeholders referenced by `command`, in declaration order. */
  variable_names: string[];
  /** Latest run for the (action, feature) pair the listing was scoped to. */
  last_run: CustomActionLastRunSummary | null;
}

export interface CustomActionVariable {
  var_name: string;
  value: string;
}

export interface CustomActionRun {
  id: number;
  action_id: number;
  feature_id: number;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  started_at: string;
  ended_at: string | null;
  triggered_by: "manual" | "schedule";
}

export interface CustomActionSchedule {
  id: number;
  action_id: number;
  feature_id: number;
  interval_seconds: number;
  enabled: boolean;
  last_run_at: string | null;
}

export interface CustomActionRunResponse {
  run_id: number;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  ended_at: string | null;
}

export interface CreateCustomActionRequest {
  name: string;
  command: string;
  icon_data: string | null;
  scope: CustomActionScope;
  project_id: number | null;
}

export interface UpdateCustomActionRequest {
  name?: string;
  command?: string;
  /** `""` clears the icon. */
  icon_data?: string;
  scope?: CustomActionScope;
  project_id?: number | null;
  position?: number;
}

export interface SetCustomActionVariableRequest {
  var_name: string;
  value: string;
}

export interface SetCustomActionScheduleRequest {
  interval_seconds: number | null;
  enabled?: boolean;
}

export function getListCustomActionsQueryKey(projectId: number, featureId: number) {
  return ["custom-actions", projectId, featureId] as const;
}

export function getCustomActionVariablesQueryKey(actionId: number, featureId: number) {
  return ["custom-action-variables", actionId, featureId] as const;
}

export function getCustomActionRunsQueryKey(actionId: number, featureId: number) {
  return ["custom-action-runs", actionId, featureId] as const;
}

export function getCustomActionScheduleQueryKey(actionId: number, featureId: number) {
  return ["custom-action-schedule", actionId, featureId] as const;
}

export function useListCustomActions(
  projectId: number,
  featureId: number,
  options?: Omit<UseQueryOptions<CustomAction[], ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<CustomAction[], ErrorType<unknown>>({
    queryKey: getListCustomActionsQueryKey(projectId, featureId),
    queryFn: () =>
      customInstance({
        method: "GET",
        url: `/api/custom-actions`,
        params: { project_id: projectId, feature_id: featureId },
      }),
    ...options,
  });
}

export function useCreateCustomAction(
  options?: UseMutationOptions<CustomAction, ErrorType<unknown>, CreateCustomActionRequest>,
) {
  return useMutation<CustomAction, ErrorType<unknown>, CreateCustomActionRequest>({
    mutationFn: (data) => customInstance({ method: "POST", url: `/api/custom-actions`, data }),
    ...options,
  });
}

export function useUpdateCustomAction(
  options?: UseMutationOptions<
    CustomAction,
    ErrorType<unknown>,
    { id: number; data: UpdateCustomActionRequest }
  >,
) {
  return useMutation<
    CustomAction,
    ErrorType<unknown>,
    { id: number; data: UpdateCustomActionRequest }
  >({
    mutationFn: ({ id, data }) =>
      customInstance({ method: "PUT", url: `/api/custom-actions/${id}`, data }),
    ...options,
  });
}

export function useDeleteCustomAction(
  options?: UseMutationOptions<{ success: boolean }, ErrorType<unknown>, { id: number }>,
) {
  return useMutation<{ success: boolean }, ErrorType<unknown>, { id: number }>({
    mutationFn: ({ id }) => customInstance({ method: "DELETE", url: `/api/custom-actions/${id}` }),
    ...options,
  });
}

export function useGetCustomActionVariables(
  actionId: number,
  featureId: number,
  options?: Omit<
    UseQueryOptions<CustomActionVariable[], ErrorType<unknown>>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery<CustomActionVariable[], ErrorType<unknown>>({
    queryKey: getCustomActionVariablesQueryKey(actionId, featureId),
    queryFn: () =>
      customInstance({
        method: "GET",
        url: `/api/custom-actions/${actionId}/variables`,
        params: { feature_id: featureId },
      }),
    ...options,
  });
}

export function useSetCustomActionVariable(
  options?: UseMutationOptions<
    { success: boolean },
    ErrorType<unknown>,
    { actionId: number; featureId: number; data: SetCustomActionVariableRequest }
  >,
) {
  return useMutation<
    { success: boolean },
    ErrorType<unknown>,
    { actionId: number; featureId: number; data: SetCustomActionVariableRequest }
  >({
    mutationFn: ({ actionId, featureId, data }) =>
      customInstance({
        method: "PUT",
        url: `/api/custom-actions/${actionId}/variables`,
        params: { feature_id: featureId },
        data,
      }),
    ...options,
  });
}

export function useRunCustomAction(
  options?: UseMutationOptions<
    CustomActionRunResponse,
    ErrorType<unknown>,
    { actionId: number; featureId: number }
  >,
) {
  return useMutation<
    CustomActionRunResponse,
    ErrorType<unknown>,
    { actionId: number; featureId: number }
  >({
    mutationFn: ({ actionId, featureId }) =>
      customInstance({
        method: "POST",
        url: `/api/custom-actions/${actionId}/run`,
        params: { feature_id: featureId },
      }),
    ...options,
  });
}

export function useGetCustomActionRuns(
  actionId: number,
  featureId: number,
  limit?: number,
  options?: Omit<UseQueryOptions<CustomActionRun[], ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  return useQuery<CustomActionRun[], ErrorType<unknown>>({
    queryKey: getCustomActionRunsQueryKey(actionId, featureId),
    queryFn: () =>
      customInstance({
        method: "GET",
        url: `/api/custom-actions/${actionId}/runs`,
        params: { feature_id: featureId, limit },
      }),
    ...options,
  });
}

export function useGetCustomActionSchedule(
  actionId: number,
  featureId: number,
  options?: Omit<
    UseQueryOptions<CustomActionSchedule | null, ErrorType<unknown>>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery<CustomActionSchedule | null, ErrorType<unknown>>({
    queryKey: getCustomActionScheduleQueryKey(actionId, featureId),
    queryFn: () =>
      customInstance({
        method: "GET",
        url: `/api/custom-actions/${actionId}/schedule`,
        params: { feature_id: featureId },
      }),
    ...options,
  });
}

export function useSetCustomActionSchedule(
  options?: UseMutationOptions<
    { success: boolean },
    ErrorType<unknown>,
    { actionId: number; featureId: number; data: SetCustomActionScheduleRequest }
  >,
) {
  return useMutation<
    { success: boolean },
    ErrorType<unknown>,
    { actionId: number; featureId: number; data: SetCustomActionScheduleRequest }
  >({
    mutationFn: ({ actionId, featureId, data }) =>
      customInstance({
        method: "PUT",
        url: `/api/custom-actions/${actionId}/schedule`,
        params: { feature_id: featureId },
        data,
      }),
    ...options,
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
  project_id: number;
  feature_id?: number;
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
  projectId: number;
  featureId?: number;
  filePath: string;
}

interface FileTreeParams {
  projectId: number;
  featureId?: number;
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

function getFileSearchQueryKey(projectId: number, featureId: number | undefined, query?: string) {
  return ["editor", "search", projectId, featureId ?? null, query ?? ""] as const;
}

export function useFileSearch(
  projectId: number,
  featureId: number | undefined,
  query?: string,
  options?: Omit<UseQueryOptions<FileSearchResponse, ErrorType<unknown>>, "queryKey" | "queryFn">,
) {
  const queryParam = query ? `&query=${encodeURIComponent(query)}` : "";
  const featureParam = featureId !== undefined ? `&feature_id=${featureId}` : "";
  return useQuery<FileSearchResponse, ErrorType<unknown>>({
    queryKey: getFileSearchQueryKey(projectId, featureId, query),
    queryFn: () =>
      customInstance({
        method: "GET",
        url: `/api/editor/search?project_id=${projectId}${featureParam}${queryParam}`,
      }),
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Content search
// ---------------------------------------------------------------------------

export interface ContentSearchParams {
  query: string;
  case_sensitive?: boolean;
  whole_word?: boolean;
  is_regex?: boolean;
  respect_gitignore?: boolean;
  include_pattern?: string;
  exclude_pattern?: string;
  limit?: number;
}

export interface ContentMatch {
  path: string;
  line_number: number;
  line_content: string;
  match_start: number;
  match_end: number;
  context_before: string[];
  context_after: string[];
}

export interface ContentSearchResponse {
  matches: ContentMatch[];
  truncated: boolean;
}

function getContentSearchQueryKey(
  projectId: number,
  featureId: number | undefined,
  params: ContentSearchParams,
) {
  return ["editor", "content-search", projectId, featureId ?? null, params] as const;
}

export function useContentSearch(
  projectId: number,
  featureId: number | undefined,
  params: ContentSearchParams,
  options?: Omit<
    UseQueryOptions<ContentSearchResponse, ErrorType<unknown>>,
    "queryKey" | "queryFn"
  >,
) {
  const searchParams = new URLSearchParams();
  searchParams.set("project_id", String(projectId));
  if (featureId !== undefined) searchParams.set("feature_id", String(featureId));
  searchParams.set("query", params.query);
  if (params.case_sensitive) searchParams.set("case_sensitive", "true");
  if (params.whole_word) searchParams.set("whole_word", "true");
  if (params.is_regex) searchParams.set("is_regex", "true");
  if (params.respect_gitignore === false) searchParams.set("respect_gitignore", "false");
  if (params.include_pattern) searchParams.set("include_pattern", params.include_pattern);
  if (params.exclude_pattern) searchParams.set("exclude_pattern", params.exclude_pattern);
  if (params.limit) searchParams.set("limit", String(params.limit));

  return useQuery<ContentSearchResponse, ErrorType<unknown>>({
    queryKey: getContentSearchQueryKey(projectId, featureId, params),
    queryFn: () =>
      customInstance({
        method: "GET",
        url: `/api/editor/content-search?${searchParams.toString()}`,
      }),
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
// Binary discovery — for onboarding's "pick your CLI" picker
// ---------------------------------------------------------------------------

/** Where a discovered CLI binary candidate was found. */
export type DiscoveredSource = "override" | "login_shell_path" | "env_path" | "well_known";

export interface DiscoveredCandidate {
  /** Path as discovered (may be a symlink/shim). */
  path: string;
  /** Resolved through symlinks — the real binary behind nvm/asdf shims. */
  canonical: string;
  /** Parsed semver (e.g. "1.4.3"); null when --version couldn't be parsed. */
  version: string | null;
  source: DiscoveredSource;
}

export interface ProviderDiscovery {
  bin_name: string;
  candidates: DiscoveredCandidate[];
  /** What would be spawned right now. Null when no candidates were found. */
  selected: DiscoveredCandidate | null;
  /** User-set override path persisted in settings. Null if unset. */
  override_path: string | null;
}

export interface BinaryDiscoveryResponse {
  /** Keyed by provider id ("claude", "opencode"). */
  providers: Record<string, ProviderDiscovery>;
}

export const getBinaryDiscoveryQueryKey = (): readonly unknown[] => [
  "/api/agents/binary-discovery",
];

export function useBinaryDiscovery(
  options?: Omit<
    UseQueryOptions<BinaryDiscoveryResponse, ErrorType<unknown>>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery<BinaryDiscoveryResponse, ErrorType<unknown>>({
    queryKey: getBinaryDiscoveryQueryKey(),
    queryFn: () => customInstance({ method: "GET", url: "/api/agents/binary-discovery" }),
    // Each call hits the backend, which spawns one subprocess per candidate.
    // The set of installs on disk doesn't change minute-to-minute; default
    // refetch-on-mount/focus would burn cycles for no UX benefit.
    staleTime: Infinity,
    ...options,
  });
}

export const DEFAULT_ARTIFACT_TYPE = "default";
