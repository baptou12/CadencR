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

### ⬜ Phase 2: Frontend — AgentPromptBar component
- **Step**: 2
- **Complexity**: 3
- [ ] Create `src/renderer/components/AgentPromptBar.tsx` — a compact bar with: text input, Send button, Stop button
- [ ] Stop button visible when agent is `running`, Send button enabled when input has text
- [ ] Props: `onSend(message: string)`, `onStop()`, `status: AgentStatus`, `disabled?: boolean`
- [ ] Style: compact inline bar (not a full textarea), sits below `AgentStream` inside the panel
- [ ] Use existing shadcn `Input` and `Button` components
- [ ] Support Enter key to send, Shift+Enter for newline (use Input not Textarea since it's a single-line prompt)
- **Files**: `src/renderer/components/AgentPromptBar.tsx`
- **Commit message**: `feat: add AgentPromptBar component with send and stop controls`
- **Bisect note**: New component, not yet used — safe standalone

### ⬜ Phase 3: Integration — Wire up prompt bar and remove floating stop
- **Step**: 3
- **Complexity**: 3
- [ ] In `AgentPanel.tsx`, add `onSend`, `onStop` props and render `AgentPromptBar` below the stream (when agent has output or is running)
- [ ] In `featureId.tsx`, wire `onSend` to call `trpc.agents.sendMessage.mutate()` with the agent's `subprocessId`
- [ ] In `featureId.tsx`, wire `onStop` to call `trpc.agents.stop.mutate()` and update agent state to error + "Stopped by user"
- [ ] Remove the floating "Stop All" button from the bottom-right
- [ ] Ensure question drawer and prompt bar don't conflict (hide prompt bar when questions are pending)
- **Files**: `src/renderer/components/AgentPanel.tsx`, `src/renderer/routes/projects/$projectId/features/$featureId.tsx`
- **Commit message**: `feat: integrate per-agent prompt bar, remove floating stop button`
- **Bisect note**: Must update both files together — AgentPanel gets new props that featureId.tsx provides

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Phase 2
- **Progress**: 1/3
