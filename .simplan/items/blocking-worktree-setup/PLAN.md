# Plan: Blocking worktree setup before agent start

## Summary
Make worktree creation block before plan/brainstorm agents start, with live progress shown via the existing `WorktreeSetupSection` UI. The plan agent auto-starts once the worktree is created — no need to wait for setup commands. Single user action ("Start Planning") triggers: auto-name → create worktree (live progress) → start plan agent.

## Context
- `src/main/trpc/router.ts` lines 442-470: `startPlan` calls `resolveAgentCwd()` (returns project.path if no worktree), starts agent, THEN fires off `setupWorktreeForFeature()` async
- Same pattern for `startBrainstorm` (lines 473-501)
- `resolveAgentCwd()` (lines 152-184): returns `wtRow?.value ?? project?.path` — falls back to project path
- `src/main/agents/auto-name.ts`: `autoNameFeature()` chains worktree setup at lines 105-111 (fire-and-forget)
- `src/main/git/worktree.ts`: `setupWorktreeForFeature()` tracks progress via `feature_settings` with steps: `named` → `creating` → `created` → `setup` → `done`
- `src/renderer/components/WorktreeSetupSection.tsx`: Already shows live 3-step progress UI (Define name / Create worktree / Run setup commands) via `feature_settings` polling
- `src/renderer/hooks/useWorkflowAgents.ts`: `handleStartPlanning` calls `startPlanMutation.mutateAsync()` directly

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Worktree exists before agent starts | Create a feature, start planning, check `feature_settings` for `worktree_path` before first agent message | `worktree_path` is set before any agent_messages are created |
| Live progress visible | Watch UI during worktree creation | WorktreeSetupSection shows spinner on "Create worktree" step |
| Plan auto-starts after worktree | Create a feature, click "Start Planning" | Plan agent starts automatically once worktree is created, setup commands run in background |
| Agent cwd is the worktree path | Check agent's first tool calls in `agent_messages` | All file paths reference the worktree, not project root |
| App builds without errors | `pnpm run lint` | No lint errors |

## Phases

### ✅ Phase 1: Refactor worktree setup to support blocking-until-created
- **Step**: 1
- **Complexity**: 3
- **Tasks**:
  - [x] In `src/main/git/worktree.ts`, refactor `setupWorktreeForFeature()` to accept `{ skipSetupCommands?: boolean }` option. When true, the function returns after step `"created"` (worktree exists, path stored in `feature_settings`) without entering the setup command loop. This lets us `await` just the worktree creation, then kick off setup commands separately in the background.
  - [x] In `src/main/agents/auto-name.ts`, export a new `runAutoNameBlocking(featureId, description, cwd, projectId)` function that performs ONLY the naming logic (haiku query → parse name → update DB) without chaining `setupWorktreeForFeature()` at the end. The existing `autoNameFeature()` keeps its current behavior for backward compat.
  - [x] In `src/main/trpc/router.ts`, add `ensureWorktree` mutation to the agents sub-router:
    1. If feature has default title (`/^(Untitled Feature|Session \d+)$/`), await `runAutoNameBlocking()` to get the real name first
    2. Await `setupWorktreeForFeature(projectId, featureId, { skipSetupCommands: true })` — blocks until worktree is created
    3. Fire off `setupWorktreeForFeature(projectId, featureId, { onlySetupCommands: true })` in background (non-blocking) to run setup commands while plan agent works
    4. Return the worktree path as `cwd`
  - Note: Since `setupWorktreeForFeature` already writes progress to `feature_settings` and calls `notifyDbUpdated()` at each step, the existing `WorktreeSetupSection` component will automatically show live progress during this blocking await — no UI changes needed for progress display.
- **Files**: src/main/git/worktree.ts, src/main/agents/auto-name.ts, src/main/trpc/router.ts
- **Commit message**: fix: make worktree setup blocking before agent start
- **Implementation notes**:
  - `setupWorktreeForFeature` now accepts optional `{ skipSetupCommands?: boolean; onlySetupCommands?: boolean }` and returns `Promise<string | void>`. With `skipSetupCommands`, it returns the worktree path string after the "created" step. With `onlySetupCommands`, it skips worktree creation and only runs setup commands on an existing worktree.
  - Extracted `runSetupCommands(projectId, featureId, worktreePath)` as a private helper to avoid duplicating the setup command loop logic between the two modes.
  - `runAutoNameBlocking` signature is `(featureId, userInput, cwd)` -- dropped `projectId` param since the naming logic does not need it (worktree setup is not chained). Returns `string | null`.
  - `ensureWorktree` mutation checks for both "Untitled Feature" and "Session N" default title patterns (case-insensitive) before auto-naming.
- **Validation results**:
  - `pnpm run lint`: 0 warnings, 0 errors -- PASSED

### ✅ Phase 2: Wire up renderer for sequential worktree → auto-start plan flow
- **Step**: 2
- **Complexity**: 2
- **Tasks**:
  - [x] Remove fire-and-forget auto-naming and worktree setup from `startPlan` mutation (lines 460-467) and `startBrainstorm` mutation (lines 491-498) in `src/main/trpc/router.ts` — these are now handled by `ensureWorktree`
  - [x] Update `handleStartPlanning` in `src/renderer/hooks/useWorkflowAgents.ts` to:
    1. `await ensureWorktreeMutation.mutateAsync({ featureId, projectId, description })` — blocks with live progress shown by existing `WorktreeSetupSection`
    2. `await startPlanMutation.mutateAsync({ featureId, projectId, description })` — auto-starts plan agent using the now-available worktree path
  - [x] Update `handleStartBrainstorming` with the same sequential pattern
  - [x] Expose `isPreparingWorktree` loading state from the hook (from `ensureWorktreeMutation.isPending`) so the UI can show the "Start Planning" button in a loading state during worktree creation
- **Files**: src/main/trpc/router.ts, src/renderer/hooks/useWorkflowAgents.ts
- **Commit message**: fix: sequential worktree-then-agent flow with auto-start
- **Implementation notes**:
  - Removed the `if (hasDefaultTitle) { autoNameFeature(...) } else { setupWorktreeForFeature(...) }` blocks from both `startPlan` and `startBrainstorm` mutations in `router.ts`. These mutations now only resolve the CWD and start the agent -- worktree creation is handled by `ensureWorktree` called from the renderer before the agent start.
  - Added `ensureWorktreeMutation = trpc.agents.ensureWorktree.useMutation()` to the hook.
  - Both `handleStartPlanning` and `handleStartBrainstorming` now sequentially: (1) await `ensureWorktreeMutation.mutateAsync(...)` to block until worktree is created, then (2) await the respective agent start mutation.
  - Exposed `isPreparingWorktree: ensureWorktreeMutation.isLoading` in the return object.
  - Also made `isStartingPlan` and `isStartingBrainstorm` include the worktree loading state (OR'd with `ensureWorktreeMutation.isLoading`) so existing button consumers show loading during the full sequence without needing to check a separate flag.
  - Note: Used `.isLoading` (React Query v4) rather than `.isPending` (v5) per the project constraint that tRPC v10 + React Query v4 must be used.
- **Validation results**:
  - `pnpm run lint`: 0 warnings, 0 errors -- PASSED
  - Manual UI validation conditions (worktree exists before agent, live progress, plan auto-starts, agent CWD is worktree) require runtime testing with a running Electron app.

### ✅ Phase 3: Add CWD validation guard
- **Step**: 3
- **Complexity**: 1
- **Tasks**:
  - [x] Add `fs.existsSync(cwd)` check in `resolveAgentCwd()` in `src/main/trpc/router.ts` — throw descriptive error if directory doesn't exist
  - [x] Add CWD validation at top of `startUnifiedAgent()` in `src/main/agents/unified-agent.ts` — verify cwd exists and is a directory before spawning subprocess
- **Files**: src/main/trpc/router.ts, src/main/agents/unified-agent.ts
- **Commit message**: fix: validate agent working directory exists before spawning
- **Implementation notes**:
  - In `resolveAgentCwd()` (router.ts): Added `fs.existsSync(cwd)` check after the path is resolved but before returning. Throws a descriptive error mentioning the path and suggesting the worktree may not have been created yet. `fs` was already imported in this file.
  - In `startUnifiedAgent()` (unified-agent.ts): Added step "0" at the very top of the function, before any DB operations. Checks both `fs.existsSync(config.cwd)` and `fs.statSync(config.cwd).isDirectory()` to ensure the path exists and is actually a directory. Added `import fs from "node:fs"` since it was not previously imported.
  - This provides defense-in-depth: `resolveAgentCwd` catches bad paths at the tRPC layer, and `startUnifiedAgent` catches them at the agent layer (for any caller, not just tRPC).
- **Validation results**:
  - `pnpm run lint`: 0 warnings, 0 errors -- PASSED
