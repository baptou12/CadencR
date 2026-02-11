# Plan: Feature Page & Agent Orchestration

## Executive Summary
Build the main feature workspace page with 4 AI agents (Plan, Brainstorm, Execute, Risk/Review) powered by Claude CLI subprocesses. The feature page is the core of ProductDevR — it's where users plan, build, evaluate, and review features through dedicated AI agents. Includes git worktree management, structured output streaming, dynamic forms for user questions, and a multi-agent grid layout.

## Context
The app currently has:
- Projects + features CRUD in SQLite with tRPC
- Sidebar with project/feature lists (FeatureList.tsx, ProjectList.tsx)
- Feature statuses: draft → planned → in-progress → review → done
- TanStack Router with file-based routes (only `/` and `/settings` exist)
- shadcn/ui components, Tailwind v4, tRPC v10 + React Query v4
- No AI integration, no feature detail page, no git worktree support

Key files:
- `src/main/trpc/features.ts` — features router
- `src/main/db/migrations.ts` — DB schema
- `src/renderer/components/FeatureList.tsx` — sidebar feature list
- `src/renderer/components/Sidebar.tsx` — manages selected feature state
- `src/renderer/routes/__root.tsx` — root layout

## Research Findings
- **Claude CLI**: Use `--output-format stream-json` for structured event streaming (tool calls, text, results)
- **Subprocess**: `child_process.spawn()` from Electron main process for Claude CLI
- **IPC streaming**: Main process relays subprocess events to renderer via `webContents.send()`, renderer listens via preload bridge
- **Session resume**: Claude CLI supports `--resume <session-id>` for continuing conversations
- **Git worktrees**: `git worktree add <path> -b <branch>` to create isolated working directories
- **Gotchas**: macOS GUI apps don't inherit shell PATH — must detect Claude CLI path explicitly
- **References**: Electron Process Model docs, electron-trpc for request-response, raw IPC for streaming

## Brainstorming Summary

### Questions Asked: 24

### Requirements & Goals
- Feature page is the main workspace for a feature's entire lifecycle
- 4 agents: Plan, Brainstorm (deeper planning), Execute, Risk Analysis + Review
- Top bar shows: feature name, status, phase progress, worktree name, LOC changed, terminal button, settings button
- Middle area adapts based on feature state (buttons → agent output)

### User Experience
- "Start Planning" / "Start Brainstorming" buttons for unplanned features
- "Start Building" / "Evaluate Risk" for planned features
- Planning starts with a simple textarea for user to describe the feature
- Agent output shown as structured blocks (thinking, code, tool calls)
- Multiple concurrent agents auto-split into equal grid with focus-on-one button
- AskUserQuestion forms push up from the bottom, keeping agent output visible above
- Review agent: user chooses to add a fix phase or fix immediately with new commit

### Technical Approach
- Claude CLI subprocess with `--output-format stream-json`
- Auto-detect CLI from PATH, fallback to user-configured path in settings
- All data in SQLite: structured tables for plans, phases, agent messages
- Store Claude session IDs for resumable sessions
- Route: `/projects/:projectId/features/:featureId`
- Real-time polling for metrics (LOC, phase progress)
- Reuse/adapt simplan prompts for Plan and Brainstorm agents
- Configurable auto-commit per project and per feature

### Edge Cases & Error Handling
- Warn before app close if agents are running
- On error: show error in agent panel with retry button
- Agent sessions resumable across app restarts via Claude `--resume`
- Max 10 concurrent Claude instances

### Integration & Dependencies
- Git worktree created on feature creation
- Branch naming convention configurable per project
- Reuse project's existing Claude allowed-tools configuration
- Feature page linked from sidebar feature list click

### Testing & Quality
- No tests for MVP — separate item later
- Completion conditions: `pnpm run lint` + TypeScript compilation

### Scope & Priorities
- One large item with many phases
- All 4 agents in scope
- Keyboard shortcuts deferred to later

### Security & Compliance
- Reuse existing Claude allowed-tools from project path
- No additional permission escalation

### Operations & Maintenance
- Full agent conversation history stored in SQLite
- Session IDs stored for resume capability

### Risks & Unknowns
- Claude CLI path detection on macOS may be tricky (GUI apps don't inherit PATH)
- Stream-JSON output format parsing — need to verify exact schema
- Git worktree management complexity (cleanup, branch conflicts)
- Large number of phases — risk of scope creep during execution

## Full Q&A Log

**Q1**: Primary view? → Top bar with status/metrics, middle area with state-dependent buttons and agent panels
**Q2**: Agent execution model? → Claude CLI subprocess
**Q3**: MVP scope? → All 4 agents
**Q4**: Multi-agent grid? → Auto-split equal with focus button
**Q5**: Worktrees? → Yes, git worktrees for feature isolation
**Q6**: Output display? → Structured blocks (parsed from stream-json)
**Q7**: CLI discovery? → Auto-detect from PATH + fallback to settings
**Q8**: Data storage? → SQLite only (structured tables)
**Q9**: Plan agent logic? → Hybrid: adapt simplan prompts for UI context
**Q10**: App close with agents? → Warn + resume sessions later
**Q11**: Dynamic forms? → Bottom push-up form, agent output stays visible above
**Q12**: Concurrency limit? → 10 max
**Q13**: Plan storage format? → Structured tables (phases, tasks) for queryability + display
**Q14**: Auto-commit? → Configurable per project and per feature
**Q15**: Review agent behavior? → Code review, then user picks: add fix phase or fix immediately
**Q16**: Risk display? → Markdown report document
**Q17**: Feature routing? → /projects/:projectId/features/:featureId
**Q18**: Worktree naming? → Project-level configuration for branch prefix
**Q19**: Output format? → `--output-format stream-json` for structured events
**Q20**: Session resume? → Store session IDs, use `--resume`
**Q21**: Metrics updates? → Real-time polling
**Q22**: Worktree trigger? → On feature creation
**Q23**: Agent history? → Full history in SQLite
**Q24**: Completion conditions? → `pnpm run lint` + TypeScript check

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Lint passes | `pnpm run lint` | Exit code 0 |
| TypeScript compiles | `pnpm exec tsc --noEmit` | Exit code 0, no type errors |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1, 2   | DB migrations + project settings (independent tables) |
| 2    | 3      | Feature page route + top bar (depends on DB schema) |
| 3    | 4      | Claude CLI discovery + subprocess infrastructure |
| 4    | 5      | Agent streaming IPC bridge (main → renderer) |
| 5    | 6      | Agent output UI components (structured blocks) |
| 6    | 7      | Dynamic form (AskUserQuestion) bottom drawer |
| 7    | 8      | Multi-agent grid layout with focus mode |
| 8    | 9      | Git worktree management |
| 9    | 10     | Plan agent implementation |
| 10   | 11     | Brainstorm agent implementation |
| 11   | 12     | Execute agent implementation |
| 12   | 13     | Risk Analysis agent |
| 13   | 14     | Review agent |
| 14   | 15     | Feature state machine (status transitions + button logic) |
| 15   | 16     | Real-time metrics polling |
| 16   | 17     | Session persistence + resume |
| 17   | 18     | Close warning + cleanup |
| 18   | 19     | Sidebar navigation integration |

> **Parallelism**: Phases within the same step can run in parallel (max 4).

## Phases

### ✅ Phase 1: Database migrations for plans, phases, and agent messages
- **Step**: 1
- **Complexity**: 3
- [x] Add migration v4: `plans` table (id, feature_id, title, status, raw_markdown, created_at, updated_at)
- [x] Add migration v5: `phases` table (id, plan_id, step_number, title, status, complexity, commit_message, tasks JSON, files JSON, order_index)
- [x] Add migration v6: `agent_sessions` table (id, feature_id, agent_type, claude_session_id, status, started_at, ended_at)
- [x] Add migration v7: `agent_messages` table (id, session_id, role, content, message_type, tool_name, created_at)
- **Files**: `src/main/db/migrations.ts`
- **Commit message**: `feat: add database migrations for plans, phases, and agent sessions`
- **Bisect note**: Migrations are additive, existing tables untouched
- **Informed by**: Q8, Q13, Q20, Q23
- **Implementation notes**: Added migrations v4-v7 to the existing migrations array following the established pattern. tasks and files columns in phases table are TEXT (JSON stored as strings). All foreign keys reference parent tables. Status defaults: plans='draft', phases='pending', agent_sessions='pending', agent_messages message_type='text'.
- **Validation results**: Lint passed (0 errors), TypeScript compiled with no errors.

### ✅ Phase 2: Project settings for worktree and commit configuration
- **Step**: 1
- **Complexity**: 2
- [x] Add migration v8: `project_settings` table (id, project_id, key, value) — for branch prefix, auto-commit default, etc.
- [x] Add tRPC procedures: `projects.getSettings`, `projects.setSetting`
- [x] Add migration v9: `feature_settings` table (id, feature_id, key, value) — per-feature overrides like auto-commit
- [x] Add tRPC procedures: `features.getSettings`, `features.setSetting`
- **Files**: `src/main/db/migrations.ts`, `src/main/trpc/projects.ts`, `src/main/trpc/features.ts`
- **Commit message**: `feat: add project and feature settings tables and tRPC procedures`
- **Bisect note**: New tables and procedures only, no breaking changes
- **Implementation notes**: Added migrations v8 (project_settings) and v9 (feature_settings) with UNIQUE constraints on (project_id, key) and (feature_id, key). Added getSettings (returns key-value object) and setSetting (upsert via ON CONFLICT) procedures to both projects and features routers.
- **Validation results**: Lint passed (0 errors), TypeScript compiled with no errors.
- **Informed by**: Q14, Q18

### ✅ Phase 3: Feature page route with top bar
- **Step**: 2
- **Complexity**: 3
- [x] Create route file `src/renderer/routes/projects/$projectId/features/$featureId.tsx`
- [x] Build top bar component showing: feature name, status badge, phase progress (X/Y), worktree name, LOC changed (placeholder), terminal button, settings button (no-op)
- [x] Add tRPC procedures for fetching plan progress (phases done/total)
- [x] Wire sidebar feature click to navigate to the new route
- **Files**: `src/renderer/routes/projects/$projectId/features/$featureId.tsx`, `src/renderer/components/FeatureTopBar.tsx`, `src/main/trpc/features.ts`, `src/renderer/components/FeatureList.tsx`
- **Commit message**: `feat: add feature page route with status top bar`
- **Bisect note**: New route, sidebar click now navigates instead of no-op
- **Informed by**: Q1, Q17
- **Implementation notes**: Added `getById` and `getPlanProgress` tRPC procedures to features router. Created `FeatureTopBar` component with feature name, status badge (reusing color scheme from FeatureList), phase progress (X/Y from plans/phases tables), worktree name placeholder, LOC placeholder, terminal button, and settings button (both no-op). Created route at `/projects/$projectId/features/$featureId` using TanStack Router file-based routing. Updated `FeatureList` to use `useNavigate` for navigating to the feature page on click. Route tree regenerated via `tsr generate`.
- **Validation results**: Lint passed (0 warnings, 0 errors). TypeScript compiled with no errors.

### ✅ Phase 4: Claude CLI discovery and subprocess manager
- **Step**: 3
- **Complexity**: 4
- [x] Create `src/main/agents/cli-discovery.ts` — detect `claude` binary: check PATH, common locations (/usr/local/bin, ~/.nvm, etc.), fallback to settings
- [x] Create `src/main/agents/subprocess-manager.ts` — spawn Claude CLI with `--output-format stream-json`, manage lifecycle (start, kill, resume)
- [x] Add `settings` tRPC procedure for claude CLI path configuration
- [x] Handle macOS GUI PATH issue: source user's shell profile to get PATH
- **Files**: `src/main/agents/cli-discovery.ts`, `src/main/agents/subprocess-manager.ts`, `src/main/trpc/router.ts`
- **Commit message**: `feat: add Claude CLI discovery and subprocess manager`
- **Bisect note**: Infrastructure only, no UI changes
- **Informed by**: Q2, Q7, Q11
- **Implementation notes**: Created `cli-discovery.ts` with 4-tier discovery: user settings DB > shell PATH (via `shell -ilc 'which claude'`) > process PATH > common locations (homebrew, local bin, npm, yarn). The shell sourcing handles macOS GUI PATH issue. Created `subprocess-manager.ts` with start/kill/list/cleanup/killAll functions, 10 max concurrent limit, and `--output-format stream-json` flag. Added `getClaudeCliPath` and `setClaudeCliPath` procedures to the existing settingsRouter in router.ts (not a separate settings.ts file since the settings router was already inline). The setClaudeCliPath mutation validates the file exists before saving.
- **Validation results**: Lint passed (0 errors), TypeScript compiled with no errors.

### Phase 5: Agent streaming IPC bridge
- **Step**: 4
- **Complexity**: 4
- [ ] Create `src/main/agents/ipc-bridge.ts` — relay subprocess stream-json events to renderer via `webContents.send()`
- [ ] Add preload API: `window.api.onAgentEvent(callback)`, `window.api.offAgentEvent()`
- [ ] Define TypeScript types for all stream-json event types (text, tool_call, tool_result, error, etc.)
- [ ] Create tRPC procedures: `agents.start`, `agents.stop`, `agents.resume`, `agents.list`
- [ ] Parse stream-json lines from subprocess stdout, emit typed events
- **Files**: `src/main/agents/ipc-bridge.ts`, `src/preload.ts`, `src/main/trpc/router.ts`, `src/main/agents/types.ts`
- **Commit message**: `feat: add agent IPC streaming bridge between main and renderer`
- **Bisect note**: Extends preload API, new tRPC router — no breaking changes
- **Informed by**: Q6, Q19

### Phase 6: Agent output UI components
- **Step**: 5
- **Complexity**: 4
- [ ] Create `src/renderer/components/AgentPanel.tsx` — container for a single agent's output
- [ ] Create `src/renderer/components/AgentBlock.tsx` — renders a single structured block (text, code, tool_call, tool_result, thinking)
- [ ] Create `src/renderer/components/AgentStream.tsx` — scrollable list of AgentBlocks with auto-scroll
- [ ] Style blocks: text with markdown rendering, code with syntax highlighting (use a simple approach), tool calls with name + args, thinking with collapsible section
- [ ] Add loading/spinner states for active agents
- **Files**: `src/renderer/components/AgentPanel.tsx`, `src/renderer/components/AgentBlock.tsx`, `src/renderer/components/AgentStream.tsx`
- **Commit message**: `feat: add agent output UI components with structured block rendering`
- **Bisect note**: Pure UI components, no side effects
- **Informed by**: Q6

### Phase 7: Dynamic form bottom drawer for AskUserQuestion
- **Step**: 6
- **Complexity**: 3
- [ ] Create `src/renderer/components/AgentQuestionDrawer.tsx` — bottom drawer that pushes content up
- [ ] Parse AskUserQuestion tool calls from stream-json events
- [ ] Render dynamic form: question text, option buttons, multi-select support, free-text "Other" option
- [ ] On submit, send response back to Claude CLI subprocess via stdin
- [ ] Handle multiple questions in a single AskUserQuestion call
- **Files**: `src/renderer/components/AgentQuestionDrawer.tsx`, `src/renderer/components/AgentPanel.tsx`
- **Commit message**: `feat: add dynamic form drawer for agent questions`
- **Bisect note**: Extends AgentPanel, new component
- **Informed by**: Q11, Q12 (answer 2)

### Phase 8: Multi-agent grid layout with focus mode
- **Step**: 7
- **Complexity**: 3
- [ ] Create `src/renderer/components/AgentGrid.tsx` — auto-splits into equal panels based on active agent count
- [ ] Layout logic: 1 agent = full, 2 = side-by-side, 3-4 = 2x2 grid, 5+ = scrollable grid
- [ ] Add focus button per panel — expands one agent to full width, others collapse
- [ ] Unfocus button to return to grid view
- [ ] Each cell renders an AgentPanel
- **Files**: `src/renderer/components/AgentGrid.tsx`
- **Commit message**: `feat: add multi-agent grid layout with focus mode`
- **Bisect note**: Layout component, wraps AgentPanels
- **Informed by**: Q4

### Phase 9: Git worktree management
- **Step**: 8
- **Complexity**: 4
- [ ] Create `src/main/git/worktree.ts` — create, list, remove git worktrees
- [ ] On feature creation: create worktree at `../<project-name>-<branch>` with configurable branch prefix
- [ ] Add tRPC procedures: `git.createWorktree`, `git.removeWorktree`, `git.getWorktreeInfo`
- [ ] Read project settings for branch prefix (default: `feature/`)
- [ ] Add "Open in Terminal" button functionality (open worktree path in system terminal)
- [ ] Update feature creation flow in `features.create` to auto-create worktree
- **Files**: `src/main/git/worktree.ts`, `src/main/trpc/router.ts`, `src/main/trpc/features.ts`
- **Commit message**: `feat: add git worktree management for feature isolation`
- **Bisect note**: Extends feature creation, creates worktree directory
- **Informed by**: Q5, Q18, Q22

### Phase 10: Plan agent implementation
- **Step**: 9
- **Complexity**: 5
- [ ] Create `src/main/agents/plan-agent.ts` — system prompt adapted from simplan item:plan
- [ ] Flow: user enters description in textarea → agent explores codebase → asks clarifying questions (1-12) → generates phased plan
- [ ] Store plan in `plans` table, phases in `phases` table
- [ ] Parse agent output to extract plan structure (phases, tasks, files, commit messages)
- [ ] Update feature status to "planned" on completion
- [ ] Wire "Start Planning" button on feature page to launch plan agent
- **Files**: `src/main/agents/plan-agent.ts`, `src/renderer/routes/projects/$projectId/features/$featureId.tsx`
- **Commit message**: `feat: implement Plan agent with codebase exploration and phased planning`
- **Bisect note**: New agent, extends feature page with plan flow
- **Informed by**: Q9, Q1 (answer)

### Phase 11: Brainstorm agent implementation
- **Step**: 10
- **Complexity**: 4
- [ ] Create `src/main/agents/brainstorm-agent.ts` — system prompt adapted from simplan item:brainstorm
- [ ] Flow: user enters description → agent does deep exploration + web research → asks 10-40 questions → generates comprehensive plan
- [ ] Reuse plan/phase storage from Phase 10
- [ ] Wire "Start Brainstorming" button on feature page
- **Files**: `src/main/agents/brainstorm-agent.ts`, `src/renderer/routes/projects/$projectId/features/$featureId.tsx`
- **Commit message**: `feat: implement Brainstorm agent with extensive Q&A and planning`
- **Bisect note**: New agent, parallel to plan agent
- **Informed by**: Q9, Q1 (answer)

### Phase 12: Execute agent implementation
- **Step**: 11
- **Complexity**: 5
- [ ] Create `src/main/agents/execute-agent.ts` — system prompt adapted from simplan item:exec
- [ ] Flow: reads plan phases → executes them in step order → supports parallel phase execution within steps
- [ ] Manage concurrent Claude instances (up to 10) for parallel phases
- [ ] Read auto-commit setting (project/feature level), commit after each phase if enabled
- [ ] Update phase status in DB as each completes
- [ ] Update feature status to "in-progress" when building starts
- [ ] Wire "Start Building" button on feature page
- **Files**: `src/main/agents/execute-agent.ts`, `src/renderer/routes/projects/$projectId/features/$featureId.tsx`
- **Commit message**: `feat: implement Execute agent with parallel phase execution`
- **Bisect note**: New agent, uses subprocess manager for concurrency
- **Informed by**: Q3, Q12, Q14

### Phase 13: Risk Analysis agent
- **Step**: 12
- **Complexity**: 3
- [ ] Create `src/main/agents/risk-agent.ts` — system prompt for risk evaluation
- [ ] Flow: reads plan → explores codebase → generates markdown risk report covering: deployment risks, data impact, dependency risks, verification checklist
- [ ] Store risk report in `agent_messages` or a dedicated field
- [ ] Render risk report as formatted markdown in agent panel
- [ ] Wire "Evaluate Risk" button on feature page
- **Files**: `src/main/agents/risk-agent.ts`, `src/renderer/routes/projects/$projectId/features/$featureId.tsx`
- **Commit message**: `feat: implement Risk Analysis agent with markdown report output`
- **Bisect note**: New agent, independent of execute agent
- **Informed by**: Q16

### Phase 14: Review agent
- **Step**: 13
- **Complexity**: 4
- [ ] Create `src/main/agents/review-agent.ts` — system prompt for code review
- [ ] Flow: reviews diff of all changes → flags issues → presents findings
- [ ] At end of review, show user options: "Add fix phase" (appends to plan) or "Fix immediately" (new commit)
- [ ] If "Add fix phase": create new phase in DB, user can execute it later
- [ ] If "Fix immediately": launch a quick execute agent for the fix
- [ ] Update feature status to "review" when review starts, "done" if approved
- **Files**: `src/main/agents/review-agent.ts`, `src/renderer/routes/projects/$projectId/features/$featureId.tsx`
- **Commit message**: `feat: implement Review agent with fix-phase and immediate-fix options`
- **Bisect note**: New agent, depends on execute agent having run
- **Informed by**: Q15

### Phase 15: Feature state machine and button logic
- **Step**: 14
- **Complexity**: 3
- [ ] Create `src/renderer/hooks/useFeatureState.ts` — determines which buttons/actions are available based on feature status and plan existence
- [ ] State transitions: draft (no plan) → show Plan/Brainstorm buttons; planned → show Build/Risk buttons; in-progress → show agent grid; review → show review results; done → show summary
- [ ] Handle concurrent states (e.g., risk analysis while building)
- [ ] Integrate state machine with feature page layout
- **Files**: `src/renderer/hooks/useFeatureState.ts`, `src/renderer/routes/projects/$projectId/features/$featureId.tsx`
- **Commit message**: `feat: add feature state machine for contextual UI actions`
- **Bisect note**: Refactors feature page to use state-driven rendering
- **Informed by**: Q1 (answer)

### Phase 16: Real-time metrics polling
- **Step**: 15
- **Complexity**: 2
- [ ] Add tRPC procedure `git.getStats` — returns LOC changed (git diff --stat on worktree)
- [ ] Add tRPC procedure `features.getProgress` — returns phases completed/total
- [ ] Set up React Query polling (refetchInterval) on feature page for both endpoints
- [ ] Update top bar to show live metrics
- **Files**: `src/main/trpc/router.ts`, `src/main/git/worktree.ts`, `src/renderer/components/FeatureTopBar.tsx`
- **Commit message**: `feat: add real-time metrics polling for LOC and phase progress`
- **Bisect note**: Adds polling, no side effects
- **Informed by**: Q21

### Phase 17: Session persistence and resume
- **Step**: 16
- **Complexity**: 3
- [ ] On agent start: store Claude session ID in `agent_sessions` table
- [ ] On agent message: store in `agent_messages` table
- [ ] Add tRPC procedure `agents.getHistory` — returns messages for a session
- [ ] On app reopen: check for incomplete sessions, offer resume via `--resume <session-id>`
- [ ] Show previous agent conversation when returning to a feature page
- **Files**: `src/main/agents/subprocess-manager.ts`, `src/main/trpc/router.ts`, `src/renderer/components/AgentPanel.tsx`
- **Commit message**: `feat: add agent session persistence and resume capability`
- **Bisect note**: Extends existing agent infra with persistence layer
- **Informed by**: Q10, Q20, Q23

### Phase 18: Close warning and subprocess cleanup
- **Step**: 17
- **Complexity**: 2
- [ ] Add Electron `before-quit` handler: check for running agent subprocesses
- [ ] If agents running: show dialog warning user, options: "Wait" or "Quit Anyway"
- [ ] On quit: gracefully kill all subprocesses, save session state
- [ ] On window close (not quit): same behavior
- **Files**: `src/main.ts`, `src/main/agents/subprocess-manager.ts`
- **Commit message**: `feat: add close warning and graceful subprocess cleanup`
- **Bisect note**: Adds quit handler, no impact if no agents running
- **Informed by**: Q10

### Phase 19: Sidebar navigation integration
- **Step**: 18
- **Complexity**: 2
- [ ] Update FeatureList.tsx: clicking a feature navigates to `/projects/:pid/features/:fid`
- [ ] Highlight active feature in sidebar based on current route
- [ ] Show agent activity indicator (dot/spinner) on features with running agents
- [ ] Ensure back navigation works (going from feature page back to project overview)
- **Files**: `src/renderer/components/FeatureList.tsx`, `src/renderer/components/Sidebar.tsx`
- **Commit message**: `feat: integrate feature page navigation with sidebar`
- **Bisect note**: Updates click handlers and styling only
- **Informed by**: Q17

## Current Status
- **Current Phase**: Phase 5
- **Progress**: 4/19

## Deferred Items
- Keyboard shortcuts / command palette
- Test suite setup
- Diff viewer integration (separate item exists)
- Feature page settings panel functionality
- Agent permission configuration UI
- Worktree cleanup on feature deletion
