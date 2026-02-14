# Plan: Trigger diff viewer after agent code changes

## Context
The app has an existing `DiffViewerModal` that shows git diffs. It's currently triggered only from the `FeatureTopBar` "View Diff" button. The `getDiff` tRPC endpoint supports two modes: `worktree` (unstaged changes) and `branch` (diff vs target branch). The top-bar diff should keep showing branch diff; the new inline trigger should show `worktree` mode (unstaged changes).

Agent events flow: subprocess-manager.ts broadcasts `StreamEvent`s via IPC → renderer's `useSessionState` handles them. Tool use events include the tool name (e.g., "Write", "Edit") in `content_block_start` events. We can track whether file-changing tools were used during a session.

The `AgentSession` component renders agent output with an `AgentStream` + `AgentPromptBar`. The new diff trigger line should appear between the stream content and the prompt bar, visible when the agent has completed and made file changes.

## Clarifications
- **Trigger timing**: Show for any agent type that made file changes (detected by tracking Edit/Write tool_use events)
- **UI placement**: Small line below agent stream content, above prompt bar
- **Diff scope**: Inline trigger opens diff modal in `worktree` mode (unstaged changes only); top-bar diff continues showing branch diff
- **Change detection**: Track tool_use events for Write/Edit tools during streaming, set a `hasFileChanges` flag

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Lint passes | `pnpm run lint` | Exit code 0 |
| Type check passes | `npx tsc --noEmit` | No errors |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1      | Track file-changing tools in useSessionState |
| 2    | 2      | Add inline diff trigger UI to AgentSession |

> **Parallelism**: Sequential — phase 2 depends on the `hasFileChanges` state from phase 1.

## Phases

### ⬜ Phase 1: Track file-changing tool usage in useSessionState
- **Step**: 1
- **Complexity**: 2
- [ ] In `useSessionState.ts`, add a `hasFileChanges` boolean state (per single-session and per multi-subprocess)
- [ ] In the event handler, detect `content_block_start` events where `content_block.type === "tool_use"` and `name` is one of: "Write", "Edit", "NotebookEdit" (file-modifying tools)
- [ ] Set `hasFileChanges = true` when such a tool is detected
- [ ] Expose `hasFileChanges` from the hook return value
- [ ] Reset `hasFileChanges` when a new session starts
- **Files**: `src/renderer/hooks/useSessionState.ts`
- **Commit message**: `feat: track file-changing tool usage in useSessionState`
- **Bisect note**: N/A — adds state tracking without UI changes

### ⬜ Phase 2: Add inline diff trigger to AgentSession
- **Step**: 2
- **Complexity**: 3
- [ ] Add `hasFileChanges` and `onViewDiff` props to `AgentSession` component
- [ ] Create a small inline bar (between stream content and prompt bar) that shows "N files changed — Review Changes" when `hasFileChanges` is true and agent status is "complete" or "paused"
- [ ] Wire `onViewDiff` to open the `DiffViewerModal` in `worktree` mode from the parent component (FeatureWorkflowView or equivalent)
- [ ] Pass `hasFileChanges` from `useSessionState` through to `AgentSession` in all usage sites
- [ ] Style the inline bar consistently with the existing UI (muted background, small text, clickable)
- **Files**: `src/renderer/components/AgentSession.tsx`, `src/renderer/components/FeatureWorkflowView.tsx` (or parent that renders AgentSession)
- **Commit message**: `feat: add inline diff trigger after agent completes with file changes`
- **Bisect note**: Must include both the component change and the prop wiring to avoid type errors

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Not started
- **Progress**: 0/2
