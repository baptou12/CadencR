# Plan: Show diff instead of Write tool during agent execution

## Context
The agent stream UI renders tool calls as compact headers (`Write src/file.tsx`) with expandable raw JSON args, and tool results as plain text (`File written successfully`). There is no visual diff showing what actually changed.

Key infrastructure already in place:
- `@git-diff-view/react` v0.0.39 with DiffView, DiffFile, and lowlight highlighter
- `DiffViewer.tsx` with `parseUnifiedDiff()` for parsing unified diff format into hunks
- `canUseTool` callback in `subprocess-manager.ts` — fires before each tool executes, has closure access to `managed` subprocess
- `AgentBlockData` type system with `tool_call` and `tool_result` block types
- `useSessionState` hook with full event handling pipeline for both single and multi-subprocess modes

Write tool args contain `{file_path, content}`. Edit tool args contain `{file_path, old_string, new_string, replace_all?}`. We can read the old file content in `canUseTool` before the tool executes, compute the diff, and send it to the renderer.

## Clarifications
- **Old content source**: Use `canUseTool` intercept to read file before Write/Edit executes
- **Diff placement**: Replace the plain-text tool_result block with a rich diff view for Write/Edit
- **Diff renderer**: Reuse `@git-diff-view/react` (same as existing DiffViewer)
- **Default state**: Always expanded (no collapse toggle needed)
- **Scope**: Top-level Write/Edit calls only (nested Task subagent calls use existing display)

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Lint passes | `pnpm run lint` | Exit code 0 |
| Type check passes | `npx tsc --noEmit` | No TypeScript errors |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1      | Add types and install diff dependency |
| 2    | 2, 3, 4 | Main process interception, renderer state handling, and diff component (independent files) |
| 3    | 5      | Wire up rendering in AgentBlock (depends on phases 3 and 4) |

> **Parallelism**: Phases within the same step can run in parallel (max 4).

## Phases

### ⬜ Phase 1: Add types and install diff dependency
- **Step**: 1
- **Complexity**: 1
- [ ] Add `StreamFileDiff` interface to `src/main/agents/types.ts` with fields: `type: "file_diff"`, `file_path: string`, `old_content: string`, `new_content: string`
- [ ] Add `StreamFileDiff` to the `StreamEvent` union type
- [ ] Add optional `diffData?: { filePath: string; oldContent: string; newContent: string }` field to `AgentBlockData` in `src/renderer/components/AgentBlock.tsx`
- [ ] Install `diff` npm package and `@types/diff` for computing unified diffs from old/new content
- **Files**: `src/main/agents/types.ts`, `src/renderer/components/AgentBlock.tsx`, `package.json`
- **Commit message**: `feat: add file_diff event type and diffData field for inline diffs`
- **Bisect note**: Adding unused types and an unused dependency — safe intermediate state

### ⬜ Phase 2: Main process canUseTool interception
- **Step**: 2
- **Complexity**: 3
- [ ] In `runSdkQuery` in `src/main/agents/subprocess-manager.ts`, extend the `canUseTool` callback to intercept Write and Edit tool calls
- [ ] For Write: read old file content from disk at `path.resolve(options.cwd, input.file_path)`, use `input.content` as new content
- [ ] For Edit: read old file content, compute new content by applying `old_string → new_string` replacement (respect `replace_all` flag)
- [ ] Handle edge cases: new file (old content = ""), read errors (skip diff), binary files (skip diff)
- [ ] Broadcast `file_diff` event via `broadcastEvent(managed.id, managed.agentType, {...})` before returning `allow`
- [ ] Do NOT persist `file_diff` events to agent_messages (they're ephemeral display data)
- **Files**: `src/main/agents/subprocess-manager.ts`
- **Commit message**: `feat: intercept Write/Edit in canUseTool to capture file diffs`
- **Bisect note**: Broadcasts file_diff events that renderer doesn't handle yet — harmless since unknown event types are ignored by useSessionState

### ⬜ Phase 3: Handle file_diff events in renderer state
- **Step**: 2
- **Complexity**: 2
- [ ] In `handleSingleEvent` in `src/renderer/hooks/useSessionState.ts`, add case for `file_diff` event type
- [ ] When `file_diff` arrives, find the last top-level tool_call block with `toolName === "Write" || toolName === "Edit"` and matching file path (from toolArgs)
- [ ] Attach `diffData` to that block: `{ filePath: event.file_path, oldContent: event.old_content, newContent: event.new_content }`
- [ ] Also handle in `handleMultiEvent` for execute agent multi-subprocess mode (same logic, scoped to subprocess blocks)
- **Files**: `src/renderer/hooks/useSessionState.ts`
- **Commit message**: `feat: handle file_diff events and attach diffData to Write/Edit blocks`
- **Bisect note**: Adds handler for new event type and stores data on blocks — no rendering changes yet, safe intermediate state

### ⬜ Phase 4: InlineDiffBlock component
- **Step**: 2
- **Complexity**: 3
- [ ] Create `src/renderer/components/InlineDiffBlock.tsx` component
- [ ] Accept props: `filePath: string`, `oldContent: string`, `newContent: string`
- [ ] Use `createTwoFilesPatch` from `diff` library to compute unified diff from old/new content
- [ ] Extract `parseUnifiedDiff` utility from `src/renderer/components/diff/DiffViewer.tsx` into `src/renderer/lib/parse-unified-diff.ts` (shared between DiffViewer and InlineDiffBlock)
- [ ] Update DiffViewer.tsx to import from the shared utility
- [ ] Parse the unified diff into hunks, create `DiffFile` instance with `@git-diff-view/react`
- [ ] Render using `DiffView` component in unified mode, dark theme, wrap enabled, font size 13
- [ ] Include compact file header showing file path and +/- line counts
- [ ] Use existing `dracula-diff.css` styles (import from `./diff/dracula-diff.css`)
- [ ] Handle edge case: identical content (show "No changes" message)
- **Files**: `src/renderer/components/InlineDiffBlock.tsx`, `src/renderer/lib/parse-unified-diff.ts`, `src/renderer/components/diff/DiffViewer.tsx`
- **Commit message**: `feat: create InlineDiffBlock component with @git-diff-view/react`
- **Bisect note**: New component not yet imported anywhere — safe. DiffViewer import path change must be included to avoid broken import.

### ⬜ Phase 5: Wire up rendering in AgentBlock
- **Step**: 3
- **Complexity**: 2
- [ ] In `src/renderer/components/AgentBlock.tsx`, modify the `tool_result` case in `AgentBlock` component
- [ ] When rendering a `tool_result` block, look back at the preceding blocks to find the matching `tool_call` with `toolName === "Write" || "Edit"` that has `diffData`
- [ ] If diffData exists, render `<InlineDiffBlock>` instead of `<ToolResultBlock>` — always expanded per user preference
- [ ] If diffData is missing (e.g., error reading file, nested task), fall back to existing `<ToolResultBlock>`
- [ ] Pass `blocks` array to AgentBlock for context lookup, or restructure to pass diffData directly from parent
- [ ] Alternative approach: render the diff inside the `ToolCallBlock` for Write/Edit when `diffData` is present, and keep `ToolResultBlock` as a compact success/error indicator below it
- **Files**: `src/renderer/components/AgentBlock.tsx`
- **Commit message**: `feat: render inline diffs for Write/Edit tool calls in agent stream`
- **Bisect note**: N/A — final integration phase

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Not started
- **Progress**: 0/5
