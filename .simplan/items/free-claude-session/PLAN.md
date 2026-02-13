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

### ⬜ Phase 1: Add `type` column to features table
- **Step**: 1
- **Complexity**: 1
- [ ] Add migration to add `type TEXT NOT NULL DEFAULT 'feature'` column to `features` table
- [ ] Update `src/main/db/types.ts` to include `type` field on Feature type
- **Files**: `src/main/db/migrations.ts`, `src/main/db/types.ts`
- **Commit message**: `feat: add type column to features table for session support`
- **Bisect note**: N/A - additive migration, default value ensures backward compatibility

### ⬜ Phase 2: Create session agent in main process
- **Step**: 2
- **Complexity**: 3
- [ ] Create `src/main/agents/session-agent.ts` — a simple agent that starts a Claude Code subprocess with a user prompt, running in the project's root directory (not a worktree)
- [ ] The agent should support: starting a new session, resuming an existing session, multi-turn messaging, and interrupt/resume
- [ ] System prompt should be minimal: "You are Claude Code working on this project. Help the user with whatever they need."
- [ ] No structured output parsing needed (unlike plan/execute agents) — just stream raw output
- **Files**: `src/main/agents/session-agent.ts`
- **Commit message**: `feat: add session agent for free-form Claude Code sessions`
- **Bisect note**: Agent file is standalone, not called yet

### ⬜ Phase 3: Add tRPC endpoints for sessions
- **Step**: 2
- **Complexity**: 3
- [ ] Add `features.createSession` mutation — creates a feature with `type='session'`, title auto-generated (e.g., "Session #N"), NO worktree creation
- [ ] Add `agents.startSession` mutation — starts session agent on project path, returns subprocess ID + session DB ID
- [ ] Ensure `agents.interrupt`, `agents.sendMessage`, `agents.getHistory` work for session agent type (they should already via subprocess manager)
- **Files**: `src/main/trpc/features.ts`, `src/main/trpc/router.ts`
- **Commit message**: `feat: add tRPC endpoints for creating and starting sessions`
- **Bisect note**: Endpoints added but not called from UI yet

### ⬜ Phase 4: Add dropdown menu to ProjectList
- **Step**: 3
- **Complexity**: 2
- [ ] Replace the delete icon on project hover with a dropdown menu (using shadcn DropdownMenu)
- [ ] Dropdown options: "New Feature" (opens existing dialog) and "New Session" (calls `features.createSession` and navigates to session page)
- [ ] Move project delete into the dropdown as well (with a separator)
- **Files**: `src/renderer/components/ProjectList.tsx`
- **Commit message**: `feat: add dropdown menu on projects with new session option`
- **Bisect note**: N/A

### ⬜ Phase 5: Create session page route
- **Step**: 3
- **Complexity**: 3
- [ ] Create route file for session page (reuse the existing feature route path — the feature page will detect `type='session'` and render differently)
- [ ] Alternatively, add a conditional render in the existing `$featureId.tsx` page: if feature type is `'session'`, render a simplified layout with just a single AgentPanel + AgentPromptBar
- [ ] Session page layout: title bar at top, scrollable AgentStream in the middle, AgentPromptBar at bottom
- [ ] On mount: check for incomplete session → show resume option. Otherwise show prompt bar to start.
- [ ] Wire up: send message starts/resumes session, pause button interrupts, prompt bar sends follow-up messages
- **Files**: `src/renderer/routes/projects/$projectId/features/$featureId.tsx`
- **Commit message**: `feat: add session view in feature page for free-form Claude sessions`
- **Bisect note**: Must have Phase 3 endpoints available

### ⬜ Phase 6: Distinguish sessions in FeatureList sidebar
- **Step**: 4
- **Complexity**: 2
- [ ] In `FeatureList`, check feature `type` — if `'session'`, show a MessageSquare icon instead of the status badge/dropdown
- [ ] Sessions should not show the status filter dropdown options (they have no workflow status)
- [ ] Add "session" to the status filter or hide sessions from status filtering entirely
- **Files**: `src/renderer/components/FeatureList.tsx`
- **Commit message**: `feat: show distinct icon for sessions in sidebar feature list`
- **Bisect note**: Requires type column from Phase 1 to be present in query results

### ⬜ Phase 7: Integration polish and edge cases
- **Step**: 5
- **Complexity**: 2
- [ ] Ensure session features don't show plan/execute/risk/review actions in the feature page
- [ ] Handle edge case: deleting a session should stop any running subprocess
- [ ] Auto-title sessions with incrementing numbers per project (e.g., "Session 1", "Session 2")
- [ ] Test the full flow: create session from dropdown → navigate to page → send message → see streaming output → pause → resume → send follow-up
- **Files**: `src/renderer/routes/projects/$projectId/features/$featureId.tsx`, `src/main/trpc/features.ts`
- **Commit message**: `feat: polish free session integration and edge cases`
- **Bisect note**: N/A

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Not started
- **Progress**: 0/7
