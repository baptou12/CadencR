# Plan: Fix worktree not working

## Context
The worktree system creates git worktrees at `~/.productdevr/<project>/<branch>` when features are created. The worktree path is stored in `feature_settings` and used as `cwd` when launching agents. Currently, worktree creation fails silently during feature creation (`features.ts:68-70`), so agents fall back to the main project path.

Key files:
- `src/main/git/worktree.ts` — worktree CRUD operations
- `src/main/trpc/features.ts` — feature creation with worktree auto-create
- `src/main/trpc/router.ts` — agent launch (cwd lookup), manual worktree create/remove
- `src/renderer/components/FeatureTopBar.tsx` — shows worktree branch status

## Clarifications
- **Symptom**: Worktree not created at all. UI shows `--` for branch.
- **Root cause**: `createWorktree` throws during feature creation, caught silently.
- **Validation**: `pnpm run lint` + TypeScript type checking.

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Linting passes | `pnpm run lint` | Exit code 0, no errors |
| Type check passes | `npx tsc --noEmit` | Exit code 0, no type errors |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1      | Add error logging and diagnostics to worktree creation |
| 2    | 2      | Surface worktree errors to the UI and add retry capability |

> **Parallelism**: Phases within the same step can run in parallel (max 4).

## Phases

### ⬜ Phase 1: Add error logging and fix silent failure in worktree creation
- **Step**: 1
- **Complexity**: 3
- [ ] In `features.ts` create mutation: log the actual error in the catch block (not just a warn), and store a `worktree_error` key in `feature_settings` with the error message so the UI can display it
- [ ] In `worktree.ts` `createWorktree`: add pre-flight checks — verify `repoPath` is a git repo (`git rev-parse --git-dir`), verify branch name is valid, log meaningful errors
- [ ] In `router.ts` agent launch methods: when `wtRow` is missing, check for `worktree_error` in feature_settings and include it in the thrown error message
- **Files**: `src/main/trpc/features.ts`, `src/main/git/worktree.ts`, `src/main/trpc/router.ts`
- **Commit message**: `fix: add error logging and diagnostics to worktree creation`
- **Bisect note**: N/A — all changes are additive error handling

### ⬜ Phase 2: Surface worktree errors in UI and add retry
- **Step**: 2
- **Complexity**: 3
- [ ] In `FeatureTopBar.tsx`: when `worktree_branch` is missing, check for `worktree_error` in feature settings and display an error indicator with the message
- [ ] Add a "Retry" button next to the error that calls the existing `git.createWorktree` mutation from `router.ts`
- [ ] After successful retry, invalidate the feature settings query so the UI updates
- **Files**: `src/renderer/components/FeatureTopBar.tsx`
- **Commit message**: `feat: surface worktree errors in UI with retry button`
- **Bisect note**: Depends on Phase 1 storing `worktree_error` in feature_settings

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Not started
- **Progress**: 0/2
