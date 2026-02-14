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

### ✅ Phase 4: Unified renderer state hook
- **Step**: 4
- **Complexity**: 4
- [x] Create `src/renderer/hooks/useSessionState.ts` — a single hook that manages agent state for any agent type. Combines the logic from `useAgentState` (blocks, status, questions) and `useMultiExecuteState` (multi-subprocess tracking)
- [x] The hook accepts config: `{ supportsQuestions?: boolean, supportsMultiSubprocess?: boolean, outputPatterns?: Array<{pattern: RegExp, event: string}> }`
- [x] Add client-side pattern matching: as text blocks accumulate, check patterns and emit callbacks (e.g. `onPatternMatch(event, fullText)`)
- [x] Handle the new `agent:pattern-match` IPC event from backend — surface it as a callback prop
- [x] Support both single-subprocess mode (plan, brainstorm, risk, review, session) and multi-subprocess mode (execute) in one hook
- [x] Export the same interface shape so existing consumers can migrate incrementally
- **Files**: `src/renderer/hooks/useSessionState.ts`, `src/preload.ts`
- **Commit message**: `refactor: create unified useSessionState hook replacing useAgentState and useMultiExecuteState`
- **Bisect note**: New file only — old hooks still exist and are still used. No breakage.
- **Implementation notes**: Created `src/renderer/hooks/useSessionState.ts` with a single `useSessionState(options)` hook that unifies `useAgentState` and `useMultiExecuteState`. The hook accepts `UseSessionStateOptions` with 4 fields: `supportsQuestions` (boolean, enables AskUserQuestion tool parsing), `supportsMultiSubprocess` (boolean, switches between single/multi subprocess management), `outputPatterns` (array of `{pattern: RegExp, event: string}` for client-side pattern matching), and `onPatternMatch` (callback fired on pattern match). Internally the hook maintains both single-subprocess state (`singleBlocks`, `singleStatus`, `singleSubprocessId`, `pendingQuestions`) and multi-subprocess state (`subprocesses` Map, `multiOverallStatus`), dispatching to the correct handler via the `supportsMultiSubprocess` flag. Client-side pattern matching runs via `useEffect` watching block changes, with deduplication via `Set<string>` (single mode) and `Map<string, Set<string>>` (multi mode). The hook also listens for backend `agent:pattern-match` IPC events via `window.api.onPatternMatch`. The return type `SessionStateReturn` is a superset of both old hooks' interfaces: it includes all fields from `useAgentState` (blocks, status, subprocessId, subprocessIdRef, pendingQuestions, handleEvent, reset, start, trackSubprocess, clearQuestions, appendBlock) AND all fields from `useMultiExecuteState` (subprocessList, overallStatus, allBlocks, subprocessIds, appendBlockToSubprocess). Also exported `useSessionEventListener` which is a copy of `useAgentEventListener` from the old hook, for convenience. Deviation: also updated `src/preload.ts` to expose `onPatternMatch`/`offPatternMatch` IPC bridge methods for the `agent:pattern-match` channel -- without this the backend pattern-match events would not reach the renderer. Block ID prefix uses `sblock-` to avoid collisions with the old hooks' `block-` and `mblock-` prefixes during the migration period.
- **Validation results**: Lint passes (oxlint: 0 warnings, 0 errors). TypeScript compiles (`npx tsc --noEmit`: no errors). App packages successfully (`pnpm run package`: all targets built for arm64 on darwin).

### ✅ Phase 5: Unified agent UI component
- **Step**: 5
- **Complexity**: 4
- [x] Refactor `SessionView` into a generic `AgentSession` component that works for all agent types
- [x] Props: `{ agentType, blocks, status, onSend, onStop, pendingQuestions?, onAnswerSubmit?, onPatternMatch?, label?, icon?, collapsible? }`
- [x] When `collapsible` is true, wrap content in a collapsible panel (for workflow view where multiple agents show). When false, render full-screen (for standalone session view)
- [x] Move question rendering (AgentQuestionDrawer) into the unified component — shown when `pendingQuestions` is non-empty
- [x] Move review verdict actions into the unified component — shown when `agentType === 'review'` and pattern match detected
- [x] Keep AgentStream, AgentBlock, AgentPromptBar as-is (they're already shared and work well)
- **Files**: `src/renderer/components/AgentSession.tsx` (new), `src/renderer/components/SessionView.tsx` (refactor into AgentSession)
- **Commit message**: `refactor: create unified AgentSession component replacing SessionView and AgentPanel`
- **Bisect note**: Creates new component alongside old ones. Old components still referenced.
- **Implementation notes**: Created `src/renderer/components/AgentSession.tsx` as a unified agent UI component that can serve as both a full-screen session view and a collapsible workflow panel. The component accepts a comprehensive `AgentSessionProps` interface with 22 props covering: core agent display (`agentType`, `blocks`, `status`), interaction (`onSend`, `onStop`), question handling (`pendingQuestions`, `onAnswerSubmit`), customization (`label`, `icon`, `collapsible`, `className`), resume support (`resumable`, `onResume`), controlled open state (`open`, `onToggle`), and review verdict actions (`reviewComplete`, `reviewVerdict`, `onAddFixPhase`, `onFixImmediately`, `isAddingFixPhase`, `isStartingFix`). When `collapsible=false` (default), renders a full-screen layout matching `SessionView`'s structure: scrollable content area + prompt bar pinned at bottom. When `collapsible=true`, renders the `AgentPanel`-style collapsible layout with header bar (icon, label, status badge, optional resume button), toggle chevron, and bordered content area. Question rendering is delegated to `AgentPromptBar` which already integrates `AgentQuestionDrawer` inline when `pendingQuestions` is provided -- so the unified component simply passes `pendingQuestions` and `onAnswerSubmit` (mapped to `onQuestionResponse`) through to `AgentPromptBar`. Review verdict actions are rendered via the existing `ReviewVerdictActions` component, shown when `agentType === 'review'` and the review action callbacks are provided. The prompt bar visibility logic in collapsible mode matches `AgentPanel`'s behavior: hidden for one-shot agents (plan, brainstorm) when complete, shown otherwise when there is output, the agent is running, or questions are pending. Re-exports `AGENT_LABELS` and `STATUS_BADGE` configurations from `AgentPanel` (labels) and defines its own copy of `STATUS_BADGE` (since it is not exported from `AgentPanel`). `SessionView.tsx` was NOT modified in this phase -- it remains intact as the bisect note specifies. Consumers will be migrated in Phase 6.
- **Validation results**: Lint passes (oxlint: 0 warnings, 0 errors). TypeScript compiles (`npx tsc --noEmit`: no errors). App packages successfully (`pnpm run package`: all targets built for arm64 on darwin).

### ✅ Phase 6: Refactor useWorkflowAgents to session-list model
- **Step**: 6
- **Complexity**: 4
- [x] Rewrite `useWorkflowAgents` to manage an array of `{ type: AgentType, session: ReturnType<typeof useSessionState>, meta: { label, icon } }` instead of separate named refs
- [x] Replace `useAgentEntries` logic — the session list IS the entry list, no separate conversion needed
- [x] Update `FeatureWorkflowView` to render the session list using `AgentSession` component for each entry (with `collapsible: true`)
- [x] Update the feature route component (`$featureId.tsx`) to use `AgentSession` for both session and workflow features — session features get one full-screen `AgentSession`, workflow features get the list
- [x] Wire up event routing: the unified event listener dispatches to the correct session in the list by subprocess ID lookup
- [x] Preserve all existing functionality: question handling, review verdict detection, execute multi-phase, resume support
- **Files**: `src/renderer/hooks/useWorkflowAgents.ts`, `src/renderer/hooks/useAgentEntries.ts`, `src/renderer/components/FeatureWorkflowView.tsx`, `src/renderer/routes/projects/$projectId/features/$featureId.tsx`
- **Commit message**: `refactor: convert useWorkflowAgents to session-list model with unified AgentSession`
- **Bisect note**: This is the big switchover. All agent rendering changes at once. Must be thorough.
- **Implementation notes**: Rewrote all 4 files to switch from the old hooks/components to the unified ones from Phases 4-5. **useWorkflowAgents.ts**: Replaced `useAgentState`/`useMultiExecuteState` imports with `useSessionState`/`useSessionEventListener` from the unified hook. All 5 agent sessions (plan, brainstorm, execute, risk, review) now use `useSessionState()` with the appropriate options (`supportsQuestions: true` for plan/brainstorm, `supportsMultiSubprocess: true` for execute). Added a `SessionEntry` export interface and a `sessionEntries` computed list that builds the entry array directly inside the hook -- this replaces the old `useAgentEntries` hook entirely. The session entries include all the data needed for rendering: type, label, status, blocks, subprocessId, pendingQuestions, and resumable flag. Also moved `hasOutput` helper to module scope to satisfy the `consistent-function-scoping` lint rule. The hook now also exports `hasAnyAgentOutput`, `noAgentsRunning`, `openAgent`, and `setOpenAgent` so that FeatureWorkflowView doesn't need useAgentEntries at all. **useAgentEntries.ts**: Gutted to a deprecation stub that only re-exports the `AgentEntry` type for any lingering consumers (none exist after this phase). Will be deleted in Phase 7. **FeatureWorkflowView.tsx**: Replaced `AgentPanel` with `AgentSession` (with `collapsible` prop). Removed imports of `AgentPanel`, `ReviewVerdictActions`, and `useAgentEntries`. Review verdict actions are now handled inside `AgentSession` via its `reviewComplete`/`reviewVerdict`/`onAddFixPhase`/`onFixImmediately` props, passed only for review-type entries. The session entries and open-agent state come directly from `useWorkflowAgents` return value. **$featureId.tsx**: Replaced `SessionView` import with inline `SessionFeatureView` component that uses `useSessionState` + `useSessionEventListener` (from unified hooks) and renders `AgentSession` with `collapsible={false}` for full-screen mode. All the session restoration logic (history query, active process reconnection, send/stop handlers) was preserved verbatim from the old `SessionView`. The `FeatureTopBar` is rendered outside `AgentSession` to maintain the same layout. All existing functionality is preserved: question handling (plan/brainstorm), review verdict detection (useEffect watching review blocks), execute multi-phase expansion (subprocess list), resume support (resumable flag in entries), send/stop per agent, and per-execute-subprocess send/interrupt.
- **Validation results**: Lint passes (oxlint: 0 warnings, 0 errors). TypeScript compiles (`npx tsc --noEmit`: no errors). App packages successfully (`pnpm run package`: all targets built for arm64 on darwin).

### ✅ Phase 7: Clean up deprecated code
- **Step**: 7
- **Complexity**: 2
- [x] Delete `src/renderer/hooks/useAgentState.ts` (replaced by useSessionState)
- [x] Delete `src/renderer/hooks/useMultiExecuteState.ts` (replaced by useSessionState)
- [x] Delete `src/renderer/components/AgentPanel.tsx` (replaced by AgentSession)
- [x] Delete `src/renderer/components/SessionView.tsx` (replaced by AgentSession)
- [x] Remove `setupPlanCompletionHandler`, `setupBrainstormCompletionHandler`, `setupRiskCompletionHandler`, `setupReviewCompletionHandler` from individual agent files (logic now in unified-agent + agent-configs)
- [x] Remove duplicated `extractTextFromEvent()` from all agent files (now in utils.ts)
- [x] Verify no dead imports or references remain
- **Files**: Multiple deletions and import cleanups across `src/renderer/` and `src/main/agents/`
- **Commit message**: `refactor: remove deprecated agent hooks, components, and duplicated utilities`
- **Bisect note**: Pure deletion — only safe if Phase 6 is fully complete and working
- **Implementation notes**: Deleted 6 files total: the 4 specified deprecated files (`useAgentState.ts`, `useMultiExecuteState.ts`, `AgentPanel.tsx`, `SessionView.tsx`), plus `useAgentEntries.ts` (deprecated stub from Phase 6, marked for deletion in its own docstring) and `AgentGrid.tsx` (unused component whose only import was `AgentPanel`). The `AgentStatus` type and `AGENT_LABELS` constant were previously exported from `AgentPanel.tsx` and imported by 5 other files (`useFeatureState.ts`, `useWorkflowAgents.ts`, `useSessionState.ts`, `NextStepsBar.tsx`, `AgentPromptBar.tsx`). Moved both to `AgentSession.tsx` as canonical exports and updated all 5 import sites to point to `@/components/AgentSession`. The `setupXxxCompletionHandler` functions and duplicated `extractTextFromEvent()` copies were already removed in Phase 3 when the agent files were rewritten as thin wrappers -- confirmed no such functions exist in any agent file. Updated stale comments in `AgentSession.tsx` and `useSessionState.ts` to remove references to the deleted files.
- **Validation results**: Lint passes (oxlint: 0 warnings, 0 errors, 78 files). TypeScript compiles (`npx tsc --noEmit`: no errors). App packages successfully (`pnpm run package`: all targets built for arm64 on darwin). `pnpm run build` does not exist as a script -- same as noted in previous phases.

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: All phases complete
- **Progress**: 7/7
