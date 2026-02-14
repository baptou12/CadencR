# Plan: Execute automation levels

## Context
The execute agent orchestrator (`src/main/agents/execute-agent.ts`) currently supports a boolean `auto_commit` setting that cascades from feature → project level. When enabled, it runs `git add -A && git commit` after each phase completes. The orchestrator runs phases in parallel within steps and sequentially across steps, using `Promise.allSettled()`.

The auto_commit setting UI lives in `src/renderer/components/ProjectList.tsx` (project settings dialog) as a checkbox. There is no global-level auto_commit setting currently.

Questions from agents are handled via `canUseTool` intercepting "AskUserQuestion" tool calls in `subprocess-manager.ts`, which broadcasts to the renderer via `agent:ask-user-question` IPC. The renderer shows an `AgentQuestionDrawer`.

The `NextStepsBar` component already exists and shows "Start Building", "Evaluate Risk", and "Start Review" buttons. This is the natural place to add a "Continue Building" button for Level 2.

Phase completion parses implementation notes and deviations from agent output before updating the DB.

## Clarifications
- **Setting scope**: Full cascade — global → project → feature (feature overrides project overrides global)
- **Migration**: `auto_commit=true` → Level 3, `auto_commit=false/missing` → Level 1 (default)
- **Level 1 UX**: Simple "Commit changes" / "Skip commit" question via AskUserQuestion
- **Level 2 UX**: "Continue to next step" button below completed agents in the current step
- **Setting name**: "Agent autonomy" with options: "Low - ask before commit", "Medium - manual continue", "High - full auto"
- **auto_commit removal**: Remove entirely from DB and UI in the final phase

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Lint passes | `pnpm run lint` | Exit code 0, no errors |
| TypeScript compiles | `npx tsc --noEmit` | Exit code 0, no type errors |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1      | Add DB migration for agent_autonomy setting key |
| 2    | 2      | Add tRPC support for global settings and autonomy level resolution |
| 3    | 3, 4   | Phase 3 updates execute-agent for all 3 levels; Phase 4 updates the project settings UI (independent files) |
| 4    | 5      | Add "Continue Building" button for Level 2 in the workflow view |
| 5    | 6      | Remove auto_commit from DB, backend, and UI |

> **Parallelism**: Phases within the same step can run in parallel (max 4).

## Phases

### ✅ Phase 1: Add DB migration for agent_autonomy
- **Step**: 1
- **Complexity**: 1
- [x] Add migration 18 in `src/main/db/migrations.ts` that migrates existing `auto_commit` values: insert `agent_autonomy` key with value `3` where `auto_commit='true'` in both `project_settings` and `feature_settings`, and value `1` elsewhere
- [x] Set default global setting `agent_autonomy` to `1` in the `settings` table (via migration or seed)
- **Files**: `src/main/db/migrations.ts`
- **Commit message**: `feat: add migration for agent_autonomy setting`
- **Bisect note**: Migration only, no code references the new key yet
- **Implementation notes**: Added migration 18 with three SQL statements: (1) INSERT OR IGNORE into settings table for global default of '1', (2) INSERT OR IGNORE into project_settings migrating auto_commit true->3, else->1, (3) same for feature_settings. Used CASE WHEN for the value mapping.
- **Validation results**: Lint passed (0 warnings, 0 errors). TypeScript compiled with no errors.

### ✅ Phase 2: Add autonomy level resolution in execute-agent
- **Step**: 2
- **Complexity**: 3
- [x] Add `getAutonomyLevel(featureId, projectId)` function in `execute-agent.ts` that cascades feature → project → global settings, returning 1, 2, or 3 (default: 1)
- [x] Replace `getAutoCommitSetting()` calls with `getAutonomyLevel()` throughout the orchestrator
- [x] For Level 3 (full auto): keep current behavior — auto-commit after each phase, auto-continue to next step
- [x] For Level 2 (manual continue): auto-commit after each phase, but STOP after a step completes — don't auto-launch next step. Update orchestrator session status to a new `waiting` status and broadcast an event so the renderer knows to show "Continue" button
- [x] For Level 1 (ask before commit): after phase output parsing (implementation notes/deviations), use the existing AskUserQuestion mechanism to ask "Commit changes?" with options "Commit changes" / "Skip commit". If commit, run git commit; then auto-continue to next step (same as Level 3 for step continuation)
- [x] Add a new tRPC mutation `agents.continueExecute` that resumes a waiting orchestrator — it reads the orchestrator session, finds the next step, and launches those phases
- [x] Remove `getAutoCommitSetting()` function
- **Files**: `src/main/agents/execute-agent.ts`, `src/main/trpc/router.ts`, `src/main/agents/types.ts`, `src/main/agents/subprocess-manager.ts`, `src/main/agents/unified-agent.ts`
- **Commit message**: `feat: implement 3 autonomy levels in execute agent`
- **Bisect note**: Must include the AskUserQuestion integration and the continue mutation together to avoid dead code paths
- **Implementation notes**: Replaced `getAutoCommitSetting()` with `getAutonomyLevel()` (feature→project→global cascade). Added `StreamExecuteWaiting` event type. Made `CompletionAction.handler` return `void | Promise<void>` and added `await` in unified-agent. Added `executeRemainingSteps()` helper, `broadcastExecuteWaiting()`, `continueExecuteAgent()` export, and `continueExecute` tRPC mutation in router.ts. **All git commit logic removed from completion handler** — commits are handled entirely by the agent subprocess via prompt instructions. **Level 1**: enriched prompt instructs agent to ask user via AskUserQuestion (approve/skip/request changes loop), agent commits itself if approved. **Level 2**: enriched prompt instructs agent to auto-commit, orchestrator stops after step with `waiting` status. **Level 3**: enriched prompt instructs agent to auto-commit, orchestrator auto-continues.
- **Validation results**: Lint passed, TypeScript compiled with no errors.

### ✅ Phase 3: Update project settings UI with autonomy dropdown
- **Step**: 3
- **Complexity**: 2
- [x] In `ProjectList.tsx`, replace the auto_commit checkbox with a dropdown/select for "Agent autonomy"
- [x] Options: "Low — ask before commit" (value `1`), "Medium — manual continue" (value `2`), "High — full auto" (value `3`)
- [x] Use `setSetting` mutation with key `agent_autonomy`
- [x] Read current value from project settings, falling back to display the effective level
- **Files**: `src/renderer/components/ProjectList.tsx`
- **Commit message**: `feat: replace auto-commit checkbox with autonomy level dropdown`
- **Bisect note**: N/A
- **Implementation notes**: Replaced the auto_commit checkbox with a shadcn Select component offering three autonomy levels. Added imports for Select components from `@/components/ui/select`. The setting reads `agent_autonomy` from project settings (falling back to `"1"`), and writes via `setSetting` mutation with key `agent_autonomy`.
- **Validation results**: Lint passed (0 warnings, 0 errors). TypeScript has one pre-existing error in `settings.tsx` (Phase 4's file, not related to this phase) — no errors in `ProjectList.tsx`.

### ✅ Phase 4: Add global autonomy setting to settings page
- **Step**: 3
- **Complexity**: 2
- [x] In `src/renderer/routes/settings.tsx`, add an "Agent Autonomy" section with the same dropdown
- [x] Wire to the global `settings` table via the settings tRPC router
- [x] Ensure the global settings router supports getting/setting the `agent_autonomy` key
- **Files**: `src/renderer/routes/settings.tsx`, `src/main/trpc/settings.ts` (if changes needed)
- **Commit message**: `feat: add global agent autonomy setting`
- **Bisect note**: N/A
- **Implementation notes**: Added `AgentAutonomySelect` component in settings.tsx using `trpc.settings.get` (key: `agent_autonomy`) and `trpc.settings.set` mutation. No router changes needed — the existing generic get/set procedures handle the `agent_autonomy` key. Section placed between Model Configuration and Custom Settings. Three options: Low (1), Medium (2), High (3).
- **Validation results**: Lint passed (0 warnings, 0 errors). TypeScript compiled with no errors.

### ✅ Phase 5: Add "Continue Building" button for Level 2
- **Step**: 4
- **Complexity**: 3
- [x] In `useWorkflowAgents.ts`, detect when the execute orchestrator session has `waiting` status (step completed, next step pending)
- [x] Expose a `canContinueBuild` flag and `onContinueBuild` handler that calls the `agents.continueExecute` mutation
- [x] In the workflow view (likely near `NextStepsBar` or below the execute agent entries), show a "Continue to Next Step" button when `canContinueBuild` is true
- [x] The button should show which step is next (e.g., "Continue to Step 2")
- [x] After clicking, the button disappears and new phase subprocesses appear
- **Files**: `src/renderer/hooks/useWorkflowAgents.ts`, `src/renderer/components/FeatureWorkflowView.tsx`, `src/renderer/components/NextStepsBar.tsx`
- **Commit message**: `feat: add continue building button for manual continue autonomy level`
- **Bisect note**: Requires Phase 2's `waiting` status and `continueExecute` mutation
- **Implementation notes**: Added `executeWaitingSessionDbId` and `executeWaitingNextStep` state to `useWorkflowAgents`. On mount, detects waiting orchestrator sessions from `sessionsQuery.data`. At runtime, wraps `execute.handleEvent` to intercept `execute_waiting` events before they reach the multi-subprocess handler (which would discard them since they use `session-` prefixed subprocessId). The wrapped handler extracts sessionDbId from the subprocessId pattern and stores it. `handleContinueBuild` calls `continueExecuteMutation`, clears waiting state, and sets execute status to running. In `NextStepsBar`, added a "Continue to Step N" button that shows when `canContinueBuild` is true, hiding the normal "Start Building" button. `FeatureWorkflowView` passes the new props and includes `canContinueBuild` in the NextStepsBar show condition.
- **Validation results**: Lint passed (0 warnings, 0 errors). TypeScript compiled with no errors.

### ✅ Phase 6: Remove auto_commit from codebase
- **Step**: 5
- **Complexity**: 2
- [x] Remove `auto_commit` key handling from `execute-agent.ts` (should already be gone from Phase 2, verify)
- [x] Remove any remaining `auto_commit` references in `ProjectList.tsx` (should be replaced in Phase 3, verify)
- [x] Add migration 19 that deletes `auto_commit` rows from `project_settings` and `feature_settings`
- [x] Search codebase for any remaining `auto_commit` references and remove them
- **Files**: `src/main/db/migrations.ts`, any files with remaining references
- **Commit message**: `chore: remove deprecated auto_commit setting`
- **Bisect note**: Safe to remove since Phase 2 already replaced all usages
- **Implementation notes**: Verified `execute-agent.ts` and `ProjectList.tsx` have no `auto_commit` references (already removed in Phases 2 and 3). Only remaining references are in migration 18 SQL/comments (kept as historical record). Added migration 19 (version 19) that DELETEs `auto_commit` rows from `project_settings` and `feature_settings`.
- **Validation results**: Lint passed (0 warnings, 0 errors). TypeScript compiled with no errors.

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: All phases complete
- **Progress**: 6/6
