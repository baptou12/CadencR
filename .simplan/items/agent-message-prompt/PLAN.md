# Plan: Agent Message Prompt

## Context
The app uses the Claude Agent SDK's `query()` function which returns a `Query` object (extends `AsyncGenerator<SDKMessage>`). The `Query` interface has:
- `streamInput(stream: AsyncIterable<SDKUserMessage>)` — inject user messages mid-conversation
- `close()` — terminate the query
- `interrupt()` — interrupt current execution

Currently, agents are fire-and-forget: the user starts them and can only interact via structured `AskUserQuestion` tool calls. The only stop mechanism is a global floating "Stop All" button. There's no per-agent stop or free-form messaging.

The `subprocess-manager.ts` creates `ManagedSubprocess` objects but doesn't store the `Query` reference — only the `AbortController`. We need to store the `Query` object to call `streamInput()`.

## Clarifications
- **Input design**: Text input + Send and Stop buttons under each agent panel
- **Message mechanism**: Use SDK's `streamInput()` for mid-conversation messaging
- **Send while running**: Yes, users can send messages while agent is actively streaming
- **Stop button**: Per-agent stop replaces the floating "Stop All" button

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Lint passes | `pnpm run lint` | Exit code 0 |
| TypeScript compiles | `npx tsc --noEmit` | No errors |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1      | Backend: store Query ref and add sendMessage API |
| 2    | 2      | Frontend: AgentPromptBar component |
| 3    | 3      | Frontend: integrate into feature page, remove floating stop |
| 4    | 4      | Inline AskUserQuestion form in prompt bar, preserve draft text |
| 5    | 5      | Polish prompt bar design |
| 6    | 6      | Disable prompt bar for plan/brainstorm agents once complete |

> **Parallelism**: Each step depends on the previous.

## Phases

### ✅ Phase 1: Backend — Store Query reference and add sendMessage endpoint
- **Step**: 1
- **Complexity**: 3
- [x] In `subprocess-manager.ts`, add `query?: Query` field to `ManagedSubprocess` interface
- [x] Store the `Query` object returned by `query()` in `runSdkQuery()`
- [x] Add `sendMessageToSubprocess(id: string, message: string)` function that calls `query.streamInput()` with an `SDKUserMessage`
- [x] Add `stopSubprocess(id: string)` function that calls `query.close()` (cleaner than abort)
- [x] In `router.ts`, add `agents.sendMessage` mutation (input: `{ id: string, message: string }`)
- [x] Export the new function from subprocess-manager
- **Files**: `src/main/agents/subprocess-manager.ts`, `src/main/trpc/router.ts`
- **Commit message**: `feat: add sendMessage and per-agent stop via SDK Query API`
- **Bisect note**: Backend-only change, no callers yet — safe standalone
- **Implementation notes**: Updated dynamic import type cast to return `Query` instead of `AsyncGenerator` so the `query` field types correctly. `stopSubprocess` is exported from subprocess-manager but not yet imported in router (will be used in Phase 3 when the stop endpoint is updated). The `sendMessageToSubprocess` function creates a single-yield async generator to pass to `streamInput()`.
- **Validation results**: Lint passes (0 warnings, 0 errors). TypeScript compiles with no errors.

### ✅ Phase 2: Frontend — AgentPromptBar component
- **Step**: 2
- **Complexity**: 3
- [x] Create `src/renderer/components/AgentPromptBar.tsx` — a compact bar with: text input, Send button, Stop button
- [x] Stop button visible when agent is `running`, Send button enabled when input has text
- [x] Props: `onSend(message: string)`, `onStop()`, `status: AgentStatus`, `disabled?: boolean`
- [x] Style: compact inline bar (not a full textarea), sits below `AgentStream` inside the panel
- [x] Use existing shadcn `Input` and `Button` components
- [x] Support Enter key to send, Shift+Enter for newline (use Input not Textarea since it's a single-line prompt)
- **Files**: `src/renderer/components/AgentPromptBar.tsx`
- **Commit message**: `feat: add AgentPromptBar component with send and stop controls`
- **Bisect note**: New component, not yet used — safe standalone
- **Implementation notes**: Created AgentPromptBar with shadcn Input and Button. Shows destructive Stop (Square icon) when running, default Send (Send icon) otherwise. Enter sends, input clears on send. Uses lucide-react icons. Compact layout with h-8 input and icon-xs buttons.
- **Validation results**: Lint passes (0 warnings, 0 errors). TypeScript compiles with no errors.

### ✅ Phase 3: Integration — Wire up prompt bar and remove floating stop
- **Step**: 3
- **Complexity**: 3
- [x] In `AgentPanel.tsx`, add `onSend`, `onStop` props and render `AgentPromptBar` below the stream (when agent has output or is running)
- [x] In `featureId.tsx`, wire `onSend` to call `trpc.agents.sendMessage.mutate()` with the agent's `subprocessId`
- [x] In `featureId.tsx`, wire `onStop` to call `trpc.agents.stop.mutate()` and update agent state to error + "Stopped by user"
- [x] Remove the floating "Stop All" button from the bottom-right
- [x] Ensure question drawer and prompt bar don't conflict (hide prompt bar when questions are pending)
- **Files**: `src/renderer/components/AgentPanel.tsx`, `src/renderer/routes/projects/$projectId/features/$featureId.tsx`
- **Commit message**: `feat: integrate per-agent prompt bar, remove floating stop button`
- **Bisect note**: Must update both files together — AgentPanel gets new props that featureId.tsx provides
- **Implementation notes**: Added `onSend` and `onStop` optional props to `AgentPanelProps`. `AgentPromptBar` renders inside the collapsible content, below the question drawer, with a `border-t`. It is hidden when `pendingQuestions` has items. In `featureId.tsx`, added `handleAgentSend` (calls `sendMessage` mutation) and `handleAgentStop` (calls `stop` mutation, sets error status + "Stopped by user" block). Removed `handleStopAll` callback and the floating stop button div. Also removed unused `SquareIcon` import. The `allAgents`/`runningAgents` are kept since `runningAgents` is used for `noAgentsRunning` and `allAgents` for auto-open logic.
- **Validation results**: Lint passes (0 warnings, 0 errors). TypeScript compiles with no errors.

### ✅ Phase 4: Show AskUserQuestion form inline, replacing prompt bar
- **Step**: 4
- **Complexity**: 3
- [x] In `AgentPromptBar.tsx`, add optional `pendingQuestions` and `onQuestionResponse` props
- [x] When `pendingQuestions` is non-empty, render the `AgentQuestionDrawer` content inline instead of the normal input+send/stop UI
- [x] Preserve the user's in-progress text in the prompt bar when questions appear (don't clear `text` state), restore it when questions are answered/dismissed
- [x] In `AgentPanel.tsx`, pass `pendingQuestions` and `onQuestionResponse` down to `AgentPromptBar` instead of rendering a separate `AgentQuestionDrawer`
- [x] Remove the standalone `AgentQuestionDrawer` rendering from `AgentPanel` (it now lives inside `AgentPromptBar`)
- **Files**: `src/renderer/components/AgentPromptBar.tsx`, `src/renderer/components/AgentPanel.tsx`
- **Commit message**: `feat: show AskUserQuestion form inline in prompt bar, preserving draft text`
- **Bisect note**: Depends on Phase 3 being integrated first — prompt bar must already be wired into AgentPanel
- **Implementation notes**: Added `pendingQuestions` and `onQuestionResponse` optional props to `AgentPromptBarProps`. When questions are pending, the component renders `AgentQuestionDrawer` inline (with `open={true}`) instead of the normal input/send/stop UI. The `text` state is preserved across question appearance/dismissal since it lives in `useState` and is not cleared when the question form renders. Removed the standalone `AgentQuestionDrawer` import and rendering from `AgentPanel.tsx`. Updated the prompt bar visibility condition to also show when `pendingQuestions` is non-empty.
- **Validation results**: Lint passes (0 warnings, 0 errors). TypeScript compiles with no errors.

### ⬜ Phase 5: Polish prompt bar design
- **Step**: 5
- **Complexity**: 2
- [ ] Review current AgentPromptBar and AgentQuestionDrawer inline rendering for visual issues
- [ ] Improve spacing, alignment, and styling of the prompt bar to match the Dracula theme and overall panel aesthetic
- [ ] Ensure the inline question form looks cohesive when rendered inside the prompt bar area
- [ ] Fix any visual regressions from the Phase 4 integration (borders, padding, background consistency)
- **Files**: `src/renderer/components/AgentPromptBar.tsx`, `src/renderer/components/AgentQuestionDrawer.tsx`
- **Commit message**: `fix: polish agent prompt bar and inline question form design`
- **Bisect note**: Style-only changes, no logic changes

### ⬜ Phase 6: Disable prompt bar for plan/brainstorm agents once complete
- **Step**: 6
- **Complexity**: 2
- [ ] In `AgentPanel.tsx` or `AgentPromptBar.tsx`, disable the prompt bar (or hide it entirely) when the agent type is `plan` or `brainstorm` and the status is `complete`
- [ ] These agents produce a one-shot result — sending follow-up messages after completion is not meaningful
- [ ] Keep the prompt bar functional while these agents are `running` (user may still want to stop them)
- **Files**: `src/renderer/components/AgentPanel.tsx`
- **Commit message**: `feat: disable prompt bar for plan and brainstorm agents after completion`
- **Bisect note**: Behavioral change — prompt bar hidden for specific agent types post-completion

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Phase 5
- **Progress**: 4/6
