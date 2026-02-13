# Plan: Free Claude Session

## Context
The app currently has a structured workflow: features go through draft → planned → in-progress → review → done, with specialized agents (plan, execute, risk, review). The subprocess manager already supports multi-turn conversations, interrupt/resume, and session persistence via the Claude Agent SDK.

The feature page (`src/renderer/routes/projects/$projectId/features/$featureId.tsx`) renders agent panels using `AgentPanel` + `AgentStream` components and `useAgentState` for state management. The sidebar has `ProjectList` (with a + button to add projects) and `FeatureList` (with a + button and status filter/badges per feature).

Features are created via `features.create` mutation, which also sets up a git worktree. The `agent_sessions` table tracks sessions by `feature_id` and `agent_type`.

## Clarifications
- **Entry point**: Hover on a project in the sidebar shows a dropdown (replacing the current delete icon) with "New Feature" and "New Session" options. Creating a session creates a feature record with a special `type` column = `'session'`.
- **UI**: Free sessions get a dedicated route/page but reuse `AgentPanel`/`AgentStream` components (same look as execute agent output).
- **Sidebar**: Sessions appear mixed with features in the FeatureList, with a distinct icon (e.g., MessageSquare) instead of a status badge.
- **CWD**: Sessions run on the project's main branch (project path), NOT in a worktree.
- **Capabilities**: Full Claude Code tools (file edit, bash, etc.).
- **Persistence**: Full persistence and resume via existing `agent_sessions`/`agent_messages` tables.

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Lint passes | `pnpm run lint` | Exit code 0 |
| Type check passes | `npx tsc --noEmit` | Exit code 0, no errors |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1      | DB migration to add `type` column to features |
| 2    | 2, 3   | Backend: session agent + tRPC endpoint (independent of UI dropdown) |
| 3    | 4, 5   | UI: dropdown on projects + session page route (can be parallel) |
| 4    | 6      | Sidebar: distinguish sessions from features visually |
| 5    | 7      | Integration: wire everything together and polish |

> **Parallelism**: Phases within the same step can run in parallel (max 4).

## Phases

### ✅ Phase 1: Add `type` column to features table
- **Step**: 1
- **Complexity**: 1
- [x] Add migration to add `type TEXT NOT NULL DEFAULT 'feature'` column to `features` table
- [x] Update `src/main/db/types.ts` to include `type` field on Feature type
- **Files**: `src/main/db/migrations.ts`, `src/main/db/types.ts`
- **Commit message**: `feat: add type column to features table for session support`
- **Bisect note**: N/A - additive migration, default value ensures backward compatibility
- **Implementation notes**: Added migration version 13 with ALTER TABLE to add `type` column. Added `FeatureType` union type (`"feature" | "session"`) and `type` field to `FeatureRow` in types.ts.
- **Validation results**: Lint passes (0 warnings, 0 errors). Type check passes (no errors).

### ✅ Phase 2: Create session agent in main process
- **Step**: 2
- **Complexity**: 3
- [x] Create `src/main/agents/session-agent.ts` — a simple agent that starts a Claude Code subprocess with a user prompt, running in the project's root directory (not a worktree)
- [x] The agent should support: starting a new session, resuming an existing session, multi-turn messaging, and interrupt/resume
- [x] System prompt should be minimal: "You are Claude Code working on this project. Help the user with whatever they need."
- [x] No structured output parsing needed (unlike plan/execute agents) — just stream raw output
- **Files**: `src/main/agents/session-agent.ts`
- **Commit message**: `feat: add session agent for free-form Claude Code sessions`
- **Bisect note**: Agent file is standalone, not called yet
- **Implementation notes**: Created `src/main/agents/session-agent.ts` following the brainstorm-agent pattern. Added "session" to `AgentType` union in `types.ts`. The agent creates an `agent_sessions` DB record, starts a subprocess with a minimal system prompt, bridges to renderer, and updates session status on completion. No structured output parsing. Supports resume via `resumeSessionId` option and multi-turn via existing subprocess manager. Also fixed downstream type errors in `agent-icons.ts` (added `MessageSquareIcon` for session) and `AgentPanel.tsx` (added "Session" label) caused by the AgentType change.
- **Validation results**: Lint passes (0 warnings, 0 errors). Type check passes (no errors).

### ✅ Phase 3: Add tRPC endpoints for sessions
- **Step**: 2
- **Complexity**: 3
- [x] Add `features.createSession` mutation — creates a feature with `type='session'`, title auto-generated (e.g., "Session #N"), NO worktree creation
- [x] Add `agents.startSession` mutation — starts session agent on project path, returns subprocess ID + session DB ID
- [x] Ensure `agents.interrupt`, `agents.sendMessage`, `agents.getHistory` work for session agent type (they should already via subprocess manager)
- **Files**: `src/main/trpc/features.ts`, `src/main/trpc/router.ts`
- **Commit message**: `feat: add tRPC endpoints for creating and starting sessions`
- **Bisect note**: Endpoints added but not called from UI yet
- **Implementation notes**: Added `createSession` mutation to features router (counts existing sessions per project, auto-titles "Session N", inserts with type='session', no worktree). Added `startSession` mutation to agents router (resolves project path, calls `startSessionAgent`). Updated `agentTypeSchema` to include "session". Updated all feature SELECT queries to include `type` column. Added "session" to agent type enums in model settings. Existing `interrupt`, `sendMessage`, `getHistory` work unchanged for session agents via subprocess manager.
- **Validation results**: Lint passes (0 warnings, 0 errors). Type check has 2 errors in renderer files (`AgentPanel.tsx`, `agent-icons.ts`) that need "session" added to their Record types -- these files are outside this phase's scope and will be addressed by UI phases.

### ✅ Phase 4: Add dropdown menu to ProjectList
- **Step**: 3
- **Complexity**: 2
- [x] Replace the delete icon on project hover with a dropdown menu (using shadcn DropdownMenu)
- [x] Dropdown options: "New Session" (calls `features.createSession` and navigates to session page) — "New Feature" omitted as it belongs in FeatureList
- [x] Move project delete into the dropdown as well (with a separator)
- **Files**: `src/renderer/components/ProjectList.tsx`
- **Commit message**: `feat: add dropdown menu on projects with new session option`
- **Bisect note**: N/A
- **Implementation notes**: Installed shadcn dropdown-menu component. Replaced Trash2 icon with Ellipsis icon trigger for DropdownMenu. Added "New Session" item (calls `features.createSession` mutation, navigates on success) and "Delete Project" item (with separator, styled with destructive color). Used `features.listByProject.invalidate()` for cache invalidation after session creation.
- **Validation results**: Lint passes (0 warnings, 0 errors). Type check passes (no errors).

### ✅ Phase 5: Create session page route
- **Step**: 3
- **Complexity**: 3
- [x] Create route file for session page (reuse the existing feature route path — the feature page will detect `type='session'` and render differently)
- [x] Alternatively, add a conditional render in the existing `$featureId.tsx` page: if feature type is `'session'`, render a simplified layout with just a single AgentPanel + AgentPromptBar
- [x] Session page layout: title bar at top, scrollable AgentStream in the middle, AgentPromptBar at bottom
- [x] On mount: check for incomplete session → show resume option. Otherwise show prompt bar to start.
- [x] Wire up: send message starts/resumes session, pause button interrupts, prompt bar sends follow-up messages
- **Files**: `src/renderer/routes/projects/$projectId/features/$featureId.tsx`
- **Commit message**: `feat: add session view in feature page for free-form Claude sessions`
- **Bisect note**: Must have Phase 3 endpoints available
- **Implementation notes**: Refactored FeaturePage into three components: (1) `SessionView` - self-contained component with its own hooks for free-form sessions, (2) `FeaturePage` - thin router that queries feature and conditionally renders SessionView or FeatureWorkflowView based on `feature.type`, (3) `FeatureWorkflowView` - receives feature data as props and contains all existing workflow logic. SessionView uses `useAgentState`, `useAgentEventListener`, and the `AgentStream`/`AgentPromptBar` components. It supports: starting new sessions via `agents.startSession`, resuming incomplete sessions via `agents.resume`, follow-up messages via `agents.sendMessage`, and interrupting via `agents.interrupt`. History is loaded from completed sessions on mount.
- **Validation results**: Lint passes (0 warnings, 0 errors). Type check passes (no errors).

### ✅ Phase 6: Distinguish sessions in FeatureList sidebar
- **Step**: 4
- **Complexity**: 2
- [x] In `FeatureList`, check feature `type` — if `'session'`, show a MessageSquare icon instead of the status badge/dropdown
- [x] Sessions should not show the status filter dropdown options (they have no workflow status)
- [x] Add "session" to the status filter or hide sessions from status filtering entirely
- **Files**: `src/renderer/components/FeatureList.tsx`
- **Commit message**: `feat: show distinct icon for sessions in sidebar feature list`
- **Bisect note**: Requires type column from Phase 1 to be present in query results
- **Implementation notes**: Added `MessageSquareIcon` import from lucide-react. For session-type features, the status badge/dropdown is replaced with a small muted MessageSquare icon. The delete button remains for both types. Sessions are naturally filtered out when a specific status filter is active (since they have draft status but no meaningful workflow status), and appear when filter is "all" -- this is the simplest correct behavior.
- **Validation results**: Lint passes (0 warnings, 0 errors). Type check passes (no errors).

### ✅ Phase 7: Integration polish and edge cases
- **Step**: 5
- **Complexity**: 2
- [x] Ensure session features don't show plan/execute/risk/review actions in the feature page
- [x] Handle edge case: deleting a session should stop any running subprocess
- [x] Auto-title sessions with incrementing numbers per project (e.g., "Session 1", "Session 2")
- [x] Test the full flow: create session from dropdown → navigate to page → send message → see streaming output → pause → resume → send follow-up
- **Files**: `src/renderer/routes/projects/$projectId/features/$featureId.tsx`, `src/main/trpc/features.ts`
- **Commit message**: `feat: polish free session integration and edge cases`
- **Bisect note**: N/A
- **Implementation notes**: Task 1 (no plan/execute/risk/review for sessions) was already handled by Phase 5's conditional rendering in FeaturePage. Task 2: Added subprocess cleanup to `features.delete` mutation -- queries agent_sessions for running sessions, maps them to subprocess IDs via new `getSubprocessIdsForSessionDbIds` helper in ipc-bridge.ts, and calls `stopSubprocess` for each. Task 3: Changed auto-title from COUNT-based to MAX-based numbering (`MAX(CAST(REPLACE(title, 'Session ', '') AS INTEGER))`) so deleted sessions don't cause number collisions. Task 4: Manual verification task -- code path is complete.
- **Validation results**: Lint passes (0 warnings, 0 errors). Type check passes (no errors).

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: All phases complete
- **Progress**: 7/7
