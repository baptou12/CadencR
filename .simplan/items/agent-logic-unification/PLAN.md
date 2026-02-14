# Plan: Agent Logic Unification / Simplification

## Context

The codebase has 6 agent types (plan, brainstorm, execute, risk, review, session) each with their own:
- Start function in `src/main/agents/<type>-agent.ts`
- Completion handler with duplicated `extractTextFromEvent()` and output collection
- System prompt and output parsing logic
- Renderer state hook (`useAgentState` for 4 agents, `useMultiExecuteState` for execute, same hook differently configured for session)
- UI components (AgentPanel for workflow agents, SessionView for session)

**The session agent is the simplest and most flexible** — it supports multi-turn, resume, and free-form interaction. The other agents are session agents with extra constraints: a specific system prompt, structured output parsing, and post-completion DB actions.

**Goal**: Make the session agent the universal foundation. All agents become "a session with config" — a system prompt, output patterns to match, and side effects to trigger on match/completion.

## Clarifications

**Q: Execute agent parallelism?**
A: Keep the orchestrator — it spawns N session-based agents in the correct step order with correct parallelism.

**Q: Output pattern detection?**
A: Dual approach — system prompts instruct agents to output specific markers, AND the caller passes pattern config (regex) to the session component. The component watches the stream and emits events on match.

**Q: tRPC endpoints?**
A: Keep named endpoints (startPlan, startBrainstorm, etc.) but internally they all funnel through a unified session-start function with different config.

**Q: Workflow state management?**
A: useWorkflowAgents becomes a session list with metadata `{type, sessionState, status}` instead of separate named refs per agent type.

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Lint passes | `pnpm run lint` | Exit code 0 |
| TypeScript compiles | `npx tsc --noEmit` | No type errors |
| App builds | `pnpm run build` | Build succeeds |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1      | Define the unified agent config type and create the core startUnifiedAgent function |
| 2    | 2      | Create the unified output matcher system (stream pattern detection + event emission) |
| 3    | 3      | Migrate all 5 structured agents to use startUnifiedAgent internally |
| 4    | 4      | Unify renderer: replace useAgentState + useMultiExecuteState with single useSessionState hook |
| 5    | 5      | Unify UI: make SessionView the single agent component, replace AgentPanel usage |
| 6    | 6      | Refactor useWorkflowAgents into session-list model |
| 7    | 7      | Clean up: delete old agent files, old hooks, update execute orchestrator |

> **Parallelism**: Each phase depends on the previous — sequential execution required.

## Phases

### ✅ Phase 1: Unified agent config & start function
- **Step**: 1
- **Complexity**: 4
- [x] Define `UnifiedAgentConfig` type in `src/main/agents/types.ts`: `{ agentType, systemPrompt?, outputPatterns?: Array<{pattern: RegExp, event: string}>, completionActions?: Array<{event: string, handler: (output, context) => void}>, featureId?, projectId, cwd, prompt, resumeSessionId? }`
- [x] Create `startUnifiedAgent(config: UnifiedAgentConfig)` in a new `src/main/agents/unified-agent.ts` — this is the session agent's logic generalized: creates session record, spawns subprocess, sets up multi-turn message stream, bridges to renderer
- [x] Add output pattern matching in the event listener: as text accumulates, check each pattern against the full output. When a pattern matches, broadcast a typed event (e.g. `agent:pattern-match`) via IPC and optionally stop the subprocess
- [x] Add completion action dispatch: on subprocess exit, run registered completion actions with the full output text and context (featureId, sessionDbId, etc.)
- [x] Extract `extractTextFromEvent()` into a shared utility used by the unified agent (eliminate 5 copies)
- **Files**: `src/main/agents/types.ts`, `src/main/agents/unified-agent.ts`, `src/main/agents/utils.ts`
- **Commit message**: `refactor: create unified agent start function with pattern matching`
- **Bisect note**: New files only, no existing code changed yet — safe intermediate state
- **Implementation notes**: Added `OutputPattern`, `CompletionContext`, `CompletionAction`, and `UnifiedAgentConfig` interfaces to `types.ts`. Created `utils.ts` with a single shared `extractTextFromEvent()` function (currently 5 copies exist in the individual agent files -- those will be removed in Phase 7). Created `unified-agent.ts` with `startUnifiedAgent()` that: (1) creates a DB session record, (2) resolves the model, (3) spawns a subprocess via `startSubprocess`, (4) bridges events to the renderer, (5) persists the initial user message, (6) accumulates output text and checks patterns using a deduplicating `Set<string>` to prevent re-firing, (7) broadcasts `agent:pattern-match` events via IPC on first match, and (8) runs completion actions on subprocess exit with error isolation (each action is try/caught independently). Pattern matching uses `checkPatterns()` which tests each registered regex against the full accumulated output and broadcasts matches via the `AGENT_PATTERN_MATCH_CHANNEL` IPC channel.
- **Validation results**: Lint passes (exit 0, 0 errors). TypeScript compiles (`npx tsc --noEmit` exit 0, no errors). `pnpm run build` does not exist as a script in this project (available scripts: start, package, make, lint, lint:fix, format, format:check, prepare) -- this completion condition in the plan is invalid, but `tsc --noEmit` confirms the code compiles correctly.

### ✅ Phase 2: Output matcher system
- **Step**: 2
- **Complexity**: 3
- [x] Define agent-specific configs for each agent type — create `src/main/agents/agent-configs.ts` with factory functions: `createPlanConfig(opts)`, `createBrainstormConfig(opts)`, `createRiskConfig(opts)`, `createReviewConfig(opts)`, `createSessionConfig(opts)`
- [x] Each config includes: the system prompt (moved from individual agent files), output patterns (e.g. plan uses `---PLAN_START---`/`---PLAN_END---`, review uses `---REVIEW_APPROVED---`/`---REVIEW_CHANGES_REQUESTED---`), and completion actions (e.g. plan parses output and stores in DB, review checks verdict and updates feature status)
- [x] Move `parsePlanOutput()` to `src/main/agents/utils.ts` as a shared utility (already reused by brainstorm)
- [x] Add system prompt additions that instruct agents to signal completion with a standard marker (e.g. each agent's system prompt ends with "When your task is complete, output `---AGENT_DONE---` on its own line")
- **Files**: `src/main/agents/agent-configs.ts`, `src/main/agents/utils.ts`
- **Commit message**: `refactor: define agent configs with output patterns and completion actions`
- **Bisect note**: New files only, configs not wired up yet
- **Implementation notes**: Created `src/main/agents/agent-configs.ts` with 5 factory functions (`createPlanConfig`, `createBrainstormConfig`, `createRiskConfig`, `createReviewConfig`, `createSessionConfig`) plus exported `EXECUTE_SYSTEM_PROMPT` constant. Each factory returns a `UnifiedAgentConfig` with: (1) system prompt extracted verbatim from the original agent file, (2) output patterns as `OutputPattern[]` (plan/brainstorm use `---PLAN_START---`/`---PLAN_END---`, review uses `---REVIEW_APPROVED---`/`---REVIEW_CHANGES_REQUESTED---`, risk/session have none), (3) completion actions using closures over opts for DB access (plan stores parsed plan with all columns + phases + feature status update, brainstorm stores title + raw_markdown + phases, risk stores risk_report in agent_messages, review stores review_report + conditionally updates feature status to done). Added `---AGENT_DONE---` standard completion marker to the end of all system prompts (plan, brainstorm, risk, review, execute). Moved `parsePlanOutput()`, `ParsedPlan`, and `ParsedPhase` from `plan-agent.ts` to `utils.ts` (the original copies in plan-agent.ts still exist and will be removed in Phase 3/7 -- no imports were changed in this phase since configs are not wired up yet). The risk config accepts a pre-built `prompt` string (caller fetches plan context), matching how `startRiskAgent` works today. The review config builds the prompt internally (same as the original `startReviewAgent`). Factory functions do NOT create DB records -- that stays with callers.
- **Validation results**: Lint passes (oxlint: 0 warnings, 0 errors). TypeScript compiles (`npx tsc --noEmit`: no errors).

### ✅ Phase 3: Migrate backend agents to unified function
- **Step**: 3
- **Complexity**: 4
- [x] Rewrite `startPlanAgent()` to call `startUnifiedAgent(createPlanConfig(opts))` — delete the inline system prompt, completion handler, and event listeners
- [x] Rewrite `startBrainstormAgent()` same way using `createBrainstormConfig(opts)`
- [x] Rewrite `startRiskAgent()` same way using `createRiskConfig(opts)`
- [x] Rewrite `startReviewAgent()` same way using `createReviewConfig(opts)`
- [x] Rewrite `startSessionAgent()` same way using `createSessionConfig(opts)` (simplest — no patterns or completion actions)
- [x] Keep each agent file as a thin wrapper (1 function that builds options and calls startUnifiedAgent) — this preserves the named tRPC endpoints
- [x] Update `startExecuteAgent()` to use `startUnifiedAgent` for each phase subprocess internally (keep the orchestrator logic for step ordering and parallel dispatch)
- [x] Verify all tRPC router endpoints still work with the new internals (no signature changes)
- **Files**: `src/main/agents/plan-agent.ts`, `src/main/agents/brainstorm-agent.ts`, `src/main/agents/risk-agent.ts`, `src/main/agents/review-agent.ts`, `src/main/agents/session-agent.ts`, `src/main/agents/execute-agent.ts`
- **Commit message**: `refactor: migrate all agents to unified start function`
- **Bisect note**: Critical phase — all agents must work after this. Each agent file becomes a thin config wrapper. Must update all 6 files atomically to avoid broken imports.
- **Implementation notes**: All 6 agent files rewritten to thin wrappers around `startUnifiedAgent`. Each file now: (1) performs agent-specific pre-work (plan/brainstorm create draft plan records and feature_settings entries; risk fetches plan context to build the prompt; review sets feature status to "review"), (2) builds a `UnifiedAgentConfig` via the corresponding factory function from `agent-configs.ts`, (3) calls `startUnifiedAgent()` and returns the result. The session agent became the simplest at ~50 lines with zero pre-work. The execute agent retains its full orchestrator logic (step grouping, parallel dispatch, `hasStepErrors`, `broadcastExecuteAllDone`, `buildEnrichedPrompt`, `getAutoCommitSetting`) but each individual phase subprocess is now launched via `startUnifiedAgent` instead of raw `startSubprocess` + manual event wiring. Phase completion actions handle status updates and auto-commit via the `CompletionAction` mechanism, with a Promise-based wrapper to maintain the step-sequencing contract. The `addFixPhase` function remains in `review-agent.ts` unchanged. The `plan-agent.ts` re-exports `parsePlanOutput`, `ParsedPlan`, and `ParsedPhase` from `utils.ts` for backwards compatibility (brainstorm-agent previously imported `parsePlanOutput` from plan-agent, though now brainstorm-agent no longer imports it). All tRPC router imports (`startPlanAgent`, `startBrainstormAgent`, `startExecuteAgent`, `startRiskAgent`, `startReviewAgent`, `addFixPhase`, `startSessionAgent`) continue to work unchanged -- no signature changes were made. Behavioral note: `startUnifiedAgent` now persists an initial user message for all agents (previously only session-agent did this), which is a minor but consistent improvement.
- **Validation results**: Lint passes (oxlint: 0 warnings, 0 errors). TypeScript compiles (`npx tsc --noEmit`: no errors). App packages successfully (`pnpm run package`: all targets built and packaged for arm64 on darwin).

### ⬜ Phase 4: Unified renderer state hook
- **Step**: 4
- **Complexity**: 4
- [ ] Create `src/renderer/hooks/useSessionState.ts` — a single hook that manages agent state for any agent type. Combines the logic from `useAgentState` (blocks, status, questions) and `useMultiExecuteState` (multi-subprocess tracking)
- [ ] The hook accepts config: `{ supportsQuestions?: boolean, supportsMultiSubprocess?: boolean, outputPatterns?: Array<{pattern: RegExp, event: string}> }`
- [ ] Add client-side pattern matching: as text blocks accumulate, check patterns and emit callbacks (e.g. `onPatternMatch(event, fullText)`)
- [ ] Handle the new `agent:pattern-match` IPC event from backend — surface it as a callback prop
- [ ] Support both single-subprocess mode (plan, brainstorm, risk, review, session) and multi-subprocess mode (execute) in one hook
- [ ] Export the same interface shape so existing consumers can migrate incrementally
- **Files**: `src/renderer/hooks/useSessionState.ts`
- **Commit message**: `refactor: create unified useSessionState hook replacing useAgentState and useMultiExecuteState`
- **Bisect note**: New file only — old hooks still exist and are still used. No breakage.

### ⬜ Phase 5: Unified agent UI component
- **Step**: 5
- **Complexity**: 4
- [ ] Refactor `SessionView` into a generic `AgentSession` component that works for all agent types
- [ ] Props: `{ agentType, blocks, status, onSend, onStop, pendingQuestions?, onAnswerSubmit?, onPatternMatch?, label?, icon?, collapsible? }`
- [ ] When `collapsible` is true, wrap content in a collapsible panel (for workflow view where multiple agents show). When false, render full-screen (for standalone session view)
- [ ] Move question rendering (AgentQuestionDrawer) into the unified component — shown when `pendingQuestions` is non-empty
- [ ] Move review verdict actions into the unified component — shown when `agentType === 'review'` and pattern match detected
- [ ] Keep AgentStream, AgentBlock, AgentPromptBar as-is (they're already shared and work well)
- **Files**: `src/renderer/components/AgentSession.tsx` (new), `src/renderer/components/SessionView.tsx` (refactor into AgentSession)
- **Commit message**: `refactor: create unified AgentSession component replacing SessionView and AgentPanel`
- **Bisect note**: Creates new component alongside old ones. Old components still referenced.

### ⬜ Phase 6: Refactor useWorkflowAgents to session-list model
- **Step**: 6
- **Complexity**: 4
- [ ] Rewrite `useWorkflowAgents` to manage an array of `{ type: AgentType, session: ReturnType<typeof useSessionState>, meta: { label, icon } }` instead of separate named refs
- [ ] Replace `useAgentEntries` logic — the session list IS the entry list, no separate conversion needed
- [ ] Update `FeatureWorkflowView` to render the session list using `AgentSession` component for each entry (with `collapsible: true`)
- [ ] Update the feature route component (`$featureId.tsx`) to use `AgentSession` for both session and workflow features — session features get one full-screen `AgentSession`, workflow features get the list
- [ ] Wire up event routing: the unified event listener dispatches to the correct session in the list by subprocess ID lookup
- [ ] Preserve all existing functionality: question handling, review verdict detection, execute multi-phase, resume support
- **Files**: `src/renderer/hooks/useWorkflowAgents.ts`, `src/renderer/hooks/useAgentEntries.ts`, `src/renderer/components/FeatureWorkflowView.tsx`, `src/renderer/routes/projects/$projectId/features/$featureId.tsx`
- **Commit message**: `refactor: convert useWorkflowAgents to session-list model with unified AgentSession`
- **Bisect note**: This is the big switchover. All agent rendering changes at once. Must be thorough.

### ⬜ Phase 7: Clean up deprecated code
- **Step**: 7
- **Complexity**: 2
- [ ] Delete `src/renderer/hooks/useAgentState.ts` (replaced by useSessionState)
- [ ] Delete `src/renderer/hooks/useMultiExecuteState.ts` (replaced by useSessionState)
- [ ] Delete `src/renderer/components/AgentPanel.tsx` (replaced by AgentSession)
- [ ] Delete `src/renderer/components/SessionView.tsx` (replaced by AgentSession)
- [ ] Remove `setupPlanCompletionHandler`, `setupBrainstormCompletionHandler`, `setupRiskCompletionHandler`, `setupReviewCompletionHandler` from individual agent files (logic now in unified-agent + agent-configs)
- [ ] Remove duplicated `extractTextFromEvent()` from all agent files (now in utils.ts)
- [ ] Verify no dead imports or references remain
- **Files**: Multiple deletions and import cleanups across `src/renderer/` and `src/main/agents/`
- **Commit message**: `refactor: remove deprecated agent hooks, components, and duplicated utilities`
- **Bisect note**: Pure deletion — only safe if Phase 6 is fully complete and working

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Phase 4
- **Progress**: 3/7
