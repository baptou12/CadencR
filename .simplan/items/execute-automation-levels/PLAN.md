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

### ⬜ Phase 2: Add autonomy level resolution in execute-agent
- **Step**: 2
- **Complexity**: 3
- [ ] Add `getAutonomyLevel(featureId, projectId)` function in `execute-agent.ts` that cascades feature → project → global settings, returning 1, 2, or 3 (default: 1)
- [ ] Replace `getAutoCommitSetting()` calls with `getAutonomyLevel()` throughout the orchestrator
- [ ] For Level 3 (full auto): keep current behavior — auto-commit after each phase, auto-continue to next step
- [ ] For Level 2 (manual continue): auto-commit after each phase, but STOP after a step completes — don't auto-launch next step. Update orchestrator session status to a new `waiting` status and broadcast an event so the renderer knows to show "Continue" button
- [ ] For Level 1 (ask before commit): after phase output parsing (implementation notes/deviations), use the existing AskUserQuestion mechanism to ask "Commit changes?" with options "Commit changes" / "Skip commit". If commit, run git commit; then auto-continue to next step (same as Level 3 for step continuation)
- [ ] Add a new tRPC mutation `agents.continueExecute` that resumes a waiting orchestrator — it reads the orchestrator session, finds the next step, and launches those phases
- [ ] Remove `getAutoCommitSetting()` function
- **Files**: `src/main/agents/execute-agent.ts`, `src/main/trpc/agents.ts` (or wherever agent routes are)
- **Commit message**: `feat: implement 3 autonomy levels in execute agent`
- **Bisect note**: Must include the AskUserQuestion integration and the continue mutation together to avoid dead code paths

### ⬜ Phase 3: Update project settings UI with autonomy dropdown
- **Step**: 3
- **Complexity**: 2
- [ ] In `ProjectList.tsx`, replace the auto_commit checkbox with a dropdown/select for "Agent autonomy"
- [ ] Options: "Low — ask before commit" (value `1`), "Medium — manual continue" (value `2`), "High — full auto" (value `3`)
- [ ] Use `setSetting` mutation with key `agent_autonomy`
- [ ] Read current value from project settings, falling back to display the effective level
- **Files**: `src/renderer/components/ProjectList.tsx`
- **Commit message**: `feat: replace auto-commit checkbox with autonomy level dropdown`
- **Bisect note**: N/A

### ⬜ Phase 4: Add global autonomy setting to settings page
- **Step**: 3
- **Complexity**: 2
- [ ] In `src/renderer/routes/settings.tsx`, add an "Agent Autonomy" section with the same dropdown
- [ ] Wire to the global `settings` table via the settings tRPC router
- [ ] Ensure the global settings router supports getting/setting the `agent_autonomy` key
- **Files**: `src/renderer/routes/settings.tsx`, `src/main/trpc/settings.ts` (if changes needed)
- **Commit message**: `feat: add global agent autonomy setting`
- **Bisect note**: N/A

### ⬜ Phase 5: Add "Continue Building" button for Level 2
- **Step**: 4
- **Complexity**: 3
- [ ] In `useWorkflowAgents.ts`, detect when the execute orchestrator session has `waiting` status (step completed, next step pending)
- [ ] Expose a `canContinueBuild` flag and `onContinueBuild` handler that calls the `agents.continueExecute` mutation
- [ ] In the workflow view (likely near `NextStepsBar` or below the execute agent entries), show a "Continue to Next Step" button when `canContinueBuild` is true
- [ ] The button should show which step is next (e.g., "Continue to Step 2")
- [ ] After clicking, the button disappears and new phase subprocesses appear
- **Files**: `src/renderer/hooks/useWorkflowAgents.ts`, `src/renderer/components/FeatureWorkflowView.tsx`, `src/renderer/components/NextStepsBar.tsx`
- **Commit message**: `feat: add continue building button for manual continue autonomy level`
- **Bisect note**: Requires Phase 2's `waiting` status and `continueExecute` mutation

### ⬜ Phase 6: Remove auto_commit from codebase
- **Step**: 5
- **Complexity**: 2
- [ ] Remove `auto_commit` key handling from `execute-agent.ts` (should already be gone from Phase 2, verify)
- [ ] Remove any remaining `auto_commit` references in `ProjectList.tsx` (should be replaced in Phase 3, verify)
- [ ] Add migration 19 that deletes `auto_commit` rows from `project_settings` and `feature_settings`
- [ ] Search codebase for any remaining `auto_commit` references and remove them
- **Files**: `src/main/db/migrations.ts`, any files with remaining references
- **Commit message**: `chore: remove deprecated auto_commit setting`
- **Bisect note**: Safe to remove since Phase 2 already replaced all usages

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Phase 2
- **Progress**: 1/6
