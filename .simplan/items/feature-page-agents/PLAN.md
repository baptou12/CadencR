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

### ✅ Phase 5: Agent streaming IPC bridge
- **Step**: 4
- **Complexity**: 4
- [x] Create `src/main/agents/ipc-bridge.ts` — relay subprocess stream-json events to renderer via `webContents.send()`
- [x] Add preload API: `window.api.onAgentEvent(callback)`, `window.api.offAgentEvent()`
- [x] Define TypeScript types for all stream-json event types (text, tool_call, tool_result, error, etc.)
- [x] Create tRPC procedures: `agents.start`, `agents.stop`, `agents.resume`, `agents.list`
- [x] Parse stream-json lines from subprocess stdout, emit typed events
- **Files**: `src/main/agents/ipc-bridge.ts`, `src/preload.ts`, `src/main/trpc/router.ts`, `src/main/agents/types.ts`
- **Commit message**: `feat: add agent IPC streaming bridge between main and renderer`
- **Bisect note**: Extends preload API, new tRPC router — no breaking changes
- **Informed by**: Q6, Q19
- **Implementation notes**: Created `types.ts` with full StreamEvent union type covering message_start, content_block_start/delta/stop, message_delta, message_stop, tool_result, error, and system events. Created `ipc-bridge.ts` with line-buffered stream-json parsing that sends AgentEvent objects to all renderer windows via `webContents.send()`. Also bridges stderr as error events and flushes buffer on stream end. Updated `preload.ts` to expose `window.api.onAgentEvent` and `window.api.offAgentEvent` via `contextBridge.exposeInMainWorld`. Added `window.api` type declaration to `env.d.ts`. Created `agentsRouter` in `router.ts` with `start`, `stop`, `resume`, and `list` procedures. The `start` and `resume` mutations call `bridgeSubprocessToRenderer` after spawning to wire up the IPC relay.
- **Validation results**: Lint passed (0 errors), TypeScript compiled with no errors.

### ✅ Phase 6: Agent output UI components
- **Step**: 5
- **Complexity**: 4
- [x] Create `src/renderer/components/AgentPanel.tsx` — container for a single agent's output
- [x] Create `src/renderer/components/AgentBlock.tsx` — renders a single structured block (text, code, tool_call, tool_result, thinking)
- [x] Create `src/renderer/components/AgentStream.tsx` — scrollable list of AgentBlocks with auto-scroll
- [x] Style blocks: text with markdown rendering, code with syntax highlighting (use a simple approach), tool calls with name + args, thinking with collapsible section
- [x] Add loading/spinner states for active agents
- **Files**: `src/renderer/components/AgentPanel.tsx`, `src/renderer/components/AgentBlock.tsx`, `src/renderer/components/AgentStream.tsx`
- **Commit message**: `feat: add agent output UI components with structured block rendering`
- **Bisect note**: Pure UI components, no side effects
- **Informed by**: Q6
- **Implementation notes**: Created three components. `AgentBlock` renders 5 block types: text (whitespace-pre-wrap), code (with language header), tool_call (collapsible with formatted JSON args), tool_result (collapsible, red styling for errors), and thinking (collapsible with purple accent). `AgentStream` is a ScrollArea wrapper with auto-scroll via useEffect on blocks.length and animated bounce dots for streaming state. `AgentPanel` is the container with agent type label, status badge (idle/running/complete/error with appropriate icons), and the stream content. Used existing shadcn ScrollArea and Badge components. No external markdown or syntax highlighting libraries -- kept simple with pre/code elements per plan guidance.
- **Validation results**: Lint passed (0 errors), TypeScript compiled with no errors.

### ✅ Phase 7: Dynamic form bottom drawer for AskUserQuestion
- **Step**: 6
- **Complexity**: 3
- [x] Create `src/renderer/components/AgentQuestionDrawer.tsx` — bottom drawer that pushes content up
- [x] Parse AskUserQuestion tool calls from stream-json events
- [x] Render dynamic form: question text, option buttons, multi-select support, free-text "Other" option
- [x] On submit, send response back to Claude CLI subprocess via stdin
- [x] Handle multiple questions in a single AskUserQuestion call
- **Files**: `src/renderer/components/AgentQuestionDrawer.tsx`, `src/renderer/components/AgentPanel.tsx`
- **Commit message**: `feat: add dynamic form drawer for agent questions`
- **Bisect note**: Extends AgentPanel, new component
- **Informed by**: Q11, Q12 (answer 2)
- **Implementation notes**: Created `AgentQuestionDrawer` component with: multi-question navigation (progress indicator), option buttons with single/multi-select support, "Other..." free-text toggle with Input field, Enter-to-submit on free text, and formatted response output combining all answers. Added `parseAskUserQuestions` utility function that handles both single question `{question, options}` and multiple questions `{questions: [...]}` formats from tool input. Added `sendSubprocessInput` to subprocess-manager.ts for writing to stdin. Added `agents.sendInput` tRPC procedure. Updated `AgentPanel` with `pendingQuestions` and `onQuestionResponse` props, rendering the drawer at the bottom of the panel to push content up.
- **Validation results**: Lint passed (0 errors), TypeScript compiled with no errors.

### ✅ Phase 8: Multi-agent grid layout with focus mode
- **Step**: 7
- **Complexity**: 3
- [x] Create `src/renderer/components/AgentGrid.tsx` — auto-splits into equal panels based on active agent count
- [x] Layout logic: 1 agent = full, 2 = side-by-side, 3-4 = 2x2 grid, 5+ = scrollable grid
- [x] Add focus button per panel — expands one agent to full width, others collapse
- [x] Unfocus button to return to grid view
- [x] Each cell renders an AgentPanel
- **Files**: `src/renderer/components/AgentGrid.tsx`
- **Commit message**: `feat: add multi-agent grid layout with focus mode`
- **Bisect note**: Layout component, wraps AgentPanels
- **Informed by**: Q4
- **Implementation notes**: Created AgentGrid component with CSS grid layout. Uses `getGridClass` helper to determine grid columns/rows based on agent count and focus state. Focus mode uses useState to track focused index; when focused, non-focused agents are filtered out with `return null` and grid switches to 1x1. Each panel gets a maximize/minimize button (positioned in the header area) that toggles focus. For 5+ agents, the grid uses 3 columns with `auto-rows-fr` and `overflow-y-auto` for scrolling. Exported `AgentGridItem` interface for parent components to use.
- **Validation results**: Lint passed (0 errors), TypeScript compiled with no errors.

### ✅ Phase 9: Git worktree management
- **Step**: 8
- **Complexity**: 4
- [x] Create `src/main/git/worktree.ts` — create, list, remove git worktrees
- [x] On feature creation: create worktree at `../<project-name>-<branch>` with configurable branch prefix
- [x] Add tRPC procedures: `git.createWorktree`, `git.removeWorktree`, `git.getWorktreeInfo`
- [x] Read project settings for branch prefix (default: `feature/`)
- [x] Add "Open in Terminal" button functionality (open worktree path in system terminal)
- [x] Update feature creation flow in `features.create` to auto-create worktree
- **Files**: `src/main/git/worktree.ts`, `src/main/trpc/router.ts`, `src/main/trpc/features.ts`, `src/renderer/components/FeatureTopBar.tsx`, `src/renderer/routes/projects/$projectId/features/$featureId.tsx`
- **Commit message**: `feat: add git worktree management for feature isolation`
- **Bisect note**: Extends feature creation, creates worktree directory
- **Informed by**: Q5, Q18, Q22
- **Implementation notes**: Created `src/main/git/worktree.ts` with functions: createWorktree (places at `../<project-name>-<safe-branch>`), listWorktrees (parses `git worktree list --porcelain`), removeWorktree, getWorktreeInfo, buildBranchName (slugifies feature title), and openInTerminal (platform-aware: macOS uses `open -a Terminal`, Windows uses `start cmd`, Linux tries x-terminal-emulator). Added `gitRouter` to router.ts with createWorktree, removeWorktree, getWorktreeInfo, and openInTerminal procedures. All procedures read worktree_path/worktree_branch from feature_settings. Updated features.create to auto-create worktree on feature creation (best-effort, catches errors). Updated FeatureTopBar to accept projectId prop, show worktree branch name, and wire terminal button to git.openInTerminal mutation. Updated feature page route to pass projectId to FeatureTopBar.
- **Validation results**: Lint passed (0 warnings, 0 errors). TypeScript compiled with no errors.

### ✅ Phase 10: Plan agent implementation
- **Step**: 9
- **Complexity**: 5
- [x] Create `src/main/agents/plan-agent.ts` — system prompt adapted from simplan item:plan
- [x] Flow: user enters description in textarea → agent explores codebase → asks clarifying questions (1-12) → generates phased plan
- [x] Store plan in `plans` table, phases in `phases` table
- [x] Parse agent output to extract plan structure (phases, tasks, files, commit messages)
- [x] Update feature status to "planned" on completion
- [x] Wire "Start Planning" button on feature page to launch plan agent
- **Files**: `src/main/agents/plan-agent.ts`, `src/renderer/routes/projects/$projectId/features/$featureId.tsx`, `src/renderer/components/ui/textarea.tsx`
- **Commit message**: `feat: implement Plan agent with codebase exploration and phased planning`
- **Bisect note**: New agent, extends feature page with plan flow
- **Informed by**: Q9, Q1 (answer)
- **Implementation notes**: Created `plan-agent.ts` with system prompt instructing the agent to explore codebase, ask 1-12 clarifying questions via AskUserQuestion, then output a structured plan between `---PLAN_START---`/`---PLAN_END---` markers. The `parsePlanOutput` function extracts phases with step, complexity, tasks, files, and commit messages using regex. On subprocess completion, the handler stores the plan in the `plans` table and phases in the `phases` table, then updates feature status to "planned". Added `agents.startPlan` tRPC mutation that resolves working directory (worktree or project path) and launches the agent. Updated the feature page with a textarea for description input and "Start Planning" button (shown when feature is in draft status). The page listens for agent events via IPC bridge and renders them in an AgentPanel, including AskUserQuestion handling for clarifying questions. Also created `textarea.tsx` shadcn UI component (was missing).
- **Validation results**: Lint passed (0 errors), TypeScript compiled with no errors.

### ✅ Phase 11: Brainstorm agent implementation
- **Step**: 10
- **Complexity**: 4
- [x] Create `src/main/agents/brainstorm-agent.ts` — system prompt adapted from simplan item:brainstorm
- [x] Flow: user enters description → agent does deep exploration + web research → asks 10-40 questions → generates comprehensive plan
- [x] Reuse plan/phase storage from Phase 10
- [x] Wire "Start Brainstorming" button on feature page
- **Files**: `src/main/agents/brainstorm-agent.ts`, `src/renderer/routes/projects/$projectId/features/$featureId.tsx`
- **Commit message**: `feat: implement Brainstorm agent with extensive Q&A and planning`
- **Bisect note**: New agent, parallel to plan agent
- **Informed by**: Q9, Q1 (answer)
- **Implementation notes**: Created `brainstorm-agent.ts` following the same pattern as `plan-agent.ts`. The brainstorm system prompt instructs the agent to do deep codebase exploration, web research, and ask 10-40 questions covering requirements, UX, technical approach, integration, edge cases, security, performance, scope, and risks. Reuses `parsePlanOutput` from plan-agent for plan parsing and the same plans/phases DB storage. Added `agents.startBrainstorm` tRPC mutation to router.ts (mirrors startPlan). Updated feature page with brainstorm state (blocks, status, pending questions, subprocess ID), a brainstorm event handler, and a "Start Brainstorming" outline button next to "Start Planning". Both buttons are mutually exclusive while loading.
- **Validation results**: Lint passed (0 warnings, 0 errors). TypeScript compiled with no errors.

### ✅ Phase 12: Execute agent implementation
- **Step**: 11
- **Complexity**: 5
- [x] Create `src/main/agents/execute-agent.ts` — system prompt adapted from simplan item:exec
- [x] Flow: reads plan phases → executes them in step order → supports parallel phase execution within steps
- [x] Manage concurrent Claude instances (up to 10) for parallel phases
- [x] Read auto-commit setting (project/feature level), commit after each phase if enabled
- [x] Update phase status in DB as each completes
- [x] Update feature status to "in-progress" when building starts
- [x] Wire "Start Building" button on feature page
- **Files**: `src/main/agents/execute-agent.ts`, `src/renderer/routes/projects/$projectId/features/$featureId.tsx`
- **Commit message**: `feat: implement Execute agent with parallel phase execution`
- **Bisect note**: New agent, uses subprocess manager for concurrency
- **Informed by**: Q3, Q12, Q14
- **Implementation notes**: Created `execute-agent.ts` with `startExecuteAgent` function that: (1) updates feature status to "in-progress", (2) creates agent session record, (3) fetches active plan and pending phases, (4) groups phases by step number, (5) executes steps sequentially with phases within each step running in parallel via Promise.allSettled, (6) updates phase status (pending -> running -> completed/error) in DB, (7) auto-commits after each phase if enabled (reads feature-level then project-level `auto_commit` setting). Added `agents.startExecute` tRPC mutation to router.ts following the same cwd resolution pattern as startPlan/startBrainstorm. Updated feature page with execute state (blocks, status), execute event handler, "Start Building" button (shown when feature is planned/in-progress and execute is idle), and an AgentPanel for execute output.
- **Validation results**: Lint passed (0 warnings, 0 errors). TypeScript compiled with no errors.

### ✅ Phase 13: Risk Analysis agent
- **Step**: 12
- **Complexity**: 3
- [x] Create `src/main/agents/risk-agent.ts` — system prompt for risk evaluation
- [x] Flow: reads plan → explores codebase → generates markdown risk report covering: deployment risks, data impact, dependency risks, verification checklist
- [x] Store risk report in `agent_messages` or a dedicated field
- [x] Render risk report as formatted markdown in agent panel
- [x] Wire "Evaluate Risk" button on feature page
- **Files**: `src/main/agents/risk-agent.ts`, `src/renderer/routes/projects/$projectId/features/$featureId.tsx`
- **Commit message**: `feat: implement Risk Analysis agent with markdown report output`
- **Bisect note**: New agent, independent of execute agent
- **Informed by**: Q16
- **Implementation notes**: Created `risk-agent.ts` following the same pattern as brainstorm-agent. System prompt instructs the agent to read the plan, explore codebase, and generate a structured markdown risk report with sections for deployment risks, data impact, dependency risks, code quality risks, verification checklist, and recommendations. The agent fetches the latest plan's raw_markdown to include as context. On completion, the risk report is stored in `agent_messages` with message_type='risk_report'. Added `agents.startRisk` tRPC mutation to router.ts with the same cwd resolution pattern. Updated feature page with risk state (blocks, status), risk event handler, "Evaluate Risk" outline button alongside "Start Building" (both shown when feature is planned/in-progress), and a risk AgentPanel.
- **Validation results**: Lint passed (0 warnings, 0 errors). TypeScript compiled with no errors.

### ✅ Phase 14: Review agent
- **Step**: 13
- **Complexity**: 4
- [x] Create `src/main/agents/review-agent.ts` — system prompt for code review
- [x] Flow: reviews diff of all changes → flags issues → presents findings
- [x] At end of review, show user options: "Add fix phase" (appends to plan) or "Fix immediately" (new commit)
- [x] If "Add fix phase": create new phase in DB, user can execute it later
- [x] If "Fix immediately": launch a quick execute agent for the fix
- [x] Update feature status to "review" when review starts, "done" if approved
- **Files**: `src/main/agents/review-agent.ts`, `src/renderer/routes/projects/$projectId/features/$featureId.tsx`
- **Commit message**: `feat: implement Review agent with fix-phase and immediate-fix options`
- **Bisect note**: New agent, depends on execute agent having run
- **Informed by**: Q15
- **Implementation notes**: Created `review-agent.ts` following the same pattern as risk-agent. System prompt instructs the agent to run `git diff` to review all changes, then produce a structured review report with Critical Issues, Warnings, Suggestions, and a Verdict (APPROVED, APPROVED_WITH_SUGGESTIONS, or CHANGES_REQUESTED). Uses `---REVIEW_APPROVED---` and `---REVIEW_CHANGES_REQUESTED---` markers to detect verdict. On completion, stores review report in `agent_messages` with message_type='review_report'. Updates feature status to "review" on start, "done" if approved. Exported `addFixPhase` function that appends a new phase to the existing plan with the review findings as the prompt. Added `agents.startReview` and `agents.addFixPhase` tRPC mutations to router.ts. Updated feature page with review state, review event handler, "Start Review" button (shown when feature is in-progress or review status), review AgentPanel, and post-review action buttons: "Add Fix Phase" (creates new phase in DB) and "Fix Immediately" (launches execute agent for pending fix phases). Verdict detection uses useEffect watching reviewBlocks content.
- **Validation results**: Lint passed (0 warnings, 0 errors). TypeScript compiled with no errors.

### ✅ Phase 15: Feature state machine and button logic
- **Step**: 14
- **Complexity**: 3
- [x] Create `src/renderer/hooks/useFeatureState.ts` — determines which buttons/actions are available based on feature status and plan existence
- [x] State transitions: draft (no plan) → show Plan/Brainstorm buttons; planned → show Build/Risk buttons; in-progress → show agent grid; review → show review results; done → show summary
- [x] Handle concurrent states (e.g., risk analysis while building)
- [x] Integrate state machine with feature page layout
- **Files**: `src/renderer/hooks/useFeatureState.ts`, `src/renderer/routes/projects/$projectId/features/$featureId.tsx`
- **Commit message**: `feat: add feature state machine for contextual UI actions`
- **Bisect note**: Refactors feature page to use state-driven rendering
- **Informed by**: Q1 (answer)
- **Implementation notes**: Created `useFeatureState` hook that derives a `FeatureView` (plan-input, planning, ready-to-build, agents-active, done) plus `AgentVisibility` and `ActionAvailability` objects from feature status and agent states. The hook uses `useMemo` for efficient recomputation. Supports concurrent agents (e.g., risk running alongside execute) via the `agents-active` view which renders all active agent panels. Refactored the feature page to replace 12 inline visibility flags with the hook's structured output, using view-based conditional rendering. Added a "done" summary view with CheckCircle2 icon.
- **Validation results**: Lint passed (0 warnings, 0 errors). TypeScript compiled with no errors.

### ✅ Phase 16: Real-time metrics polling
- **Step**: 15
- **Complexity**: 2
- [x] Add tRPC procedure `git.getStats` — returns LOC changed (git diff --stat on worktree)
- [x] Add tRPC procedure `features.getProgress` — returns phases completed/total
- [x] Set up React Query polling (refetchInterval) on feature page for both endpoints
- [x] Update top bar to show live metrics
- **Files**: `src/main/trpc/router.ts`, `src/main/git/worktree.ts`, `src/renderer/components/FeatureTopBar.tsx`
- **Commit message**: `feat: add real-time metrics polling for LOC and phase progress`
- **Bisect note**: Adds polling, no side effects
- **Informed by**: Q21
- **Implementation notes**: Added `getGitStats` function to `worktree.ts` that runs `git diff --stat` and parses the summary line for files changed, insertions, and deletions (falls back to `--cached` for staged-only changes). Added `git.getStats` tRPC query procedure to `router.ts` that looks up the feature's worktree path from feature_settings. Added `features.getProgress` procedure to `features.ts` (similar to existing `getPlanProgress` but kept as separate endpoint per plan). Updated `FeatureTopBar` to use `features.getProgress` with 5s polling and `git.getStats` with 10s polling via `refetchInterval`. LOC display now shows `+N -N` format from real git data.
- **Validation results**: Lint passed (0 warnings, 0 errors). TypeScript compiled with no errors.

### ✅ Phase 17: Session persistence and resume
- **Step**: 16
- **Complexity**: 3
- [x] On agent start: store Claude session ID in `agent_sessions` table
- [x] On agent message: store in `agent_messages` table
- [x] Add tRPC procedure `agents.getHistory` — returns messages for a session
- [x] On app reopen: check for incomplete sessions, offer resume via `--resume <session-id>`
- [x] Show previous agent conversation when returning to a feature page
- **Files**: `src/main/agents/subprocess-manager.ts`, `src/main/trpc/router.ts`, `src/renderer/components/AgentPanel.tsx`
- **Commit message**: `feat: add agent session persistence and resume capability`
- **Bisect note**: Extends existing agent infra with persistence layer
- **Informed by**: Q10, Q20, Q23
- **Implementation notes**: Updated `ipc-bridge.ts` to accept optional `sessionDbId` parameter. When provided, the bridge: (1) captures Claude session IDs from `system` events and stores them in `agent_sessions.claude_session_id`, (2) persists content-bearing stream events (text, tool_call, tool_result, error) to `agent_messages` table. Updated all 5 agent files (plan, brainstorm, execute, risk, review) to pass `sessionDbId` to `bridgeSubprocessToRenderer`. Added 3 new tRPC procedures: `agents.getHistory` (returns messages for a session), `agents.getSessions` (returns sessions for a feature with optional status filter), `agents.getIncompleteSessions` (returns running sessions with Claude session IDs for resume). Updated `AgentPanel` with optional `resumable` and `onResume` props showing a Resume button. Updated the feature page to: query incomplete sessions on mount, show resume button on panels with resumable sessions, load plan history from completed sessions on mount (merging text blocks for clean display).
- **Validation results**: Lint passed (0 warnings, 0 errors). TypeScript compiled with no errors.

### ✅ Phase 18: Close warning and subprocess cleanup
- **Step**: 17
- **Complexity**: 2
- [x] Add Electron `before-quit` handler: check for running agent subprocesses
- [x] If agents running: show dialog warning user, options: "Wait" or "Quit Anyway"
- [x] On quit: gracefully kill all subprocesses, save session state
- [x] On window close (not quit): same behavior
- **Files**: `src/main.ts`, `src/main/agents/subprocess-manager.ts`
- **Commit message**: `feat: add close warning and graceful subprocess cleanup`
- **Bisect note**: Adds quit handler, no impact if no agents running
- **Informed by**: Q10
- **Implementation notes**: Added `saveAllSessionStates` (marks running DB sessions as 'interrupted') and `gracefulShutdown` (saves state + kills all) to subprocess-manager.ts. In main.ts, added window `close` event handler and updated `before-quit` handler -- both check `hasRunningSubprocesses()` and show a dialog with "Wait" / "Quit Anyway" options. Uses `isQuitting` flag to prevent recursive dialog prompts. On "Quit Anyway", calls `gracefulShutdown()` then proceeds with close/quit. If no agents running, shutdown proceeds silently.
- **Validation results**: Lint passed (0 warnings, 0 errors). TypeScript compiled with no errors.

### ✅ Phase 19: Sidebar navigation integration
- **Step**: 18
- **Complexity**: 2
- [x] Update FeatureList.tsx: clicking a feature navigates to `/projects/:pid/features/:fid`
- [x] Highlight active feature in sidebar based on current route
- [x] Show agent activity indicator (dot/spinner) on features with running agents
- [x] Ensure back navigation works (going from feature page back to project overview)
- **Files**: `src/renderer/components/FeatureList.tsx`, `src/renderer/components/Sidebar.tsx`, `src/main/trpc/router.ts`
- **Commit message**: `feat: integrate feature page navigation with sidebar`
- **Bisect note**: Updates click handlers and styling only
- **Informed by**: Q17
- **Implementation notes**: Navigation was already wired from Phase 3. Added route-aware sidebar: `Sidebar.tsx` now uses `useRouterState` to parse projectId/featureId from the URL pathname, syncing sidebar selection with the current route (so navigating directly to a feature URL highlights it). Added `agents.getActiveFeatureIds` tRPC procedure that queries `agent_sessions` for running sessions and returns distinct feature IDs. `FeatureList.tsx` polls this every 3s and shows a spinning `Loader2Icon` next to features with active agents. Back navigation works naturally via browser history since TanStack Router manages the history stack and the sidebar is always visible.
- **Validation results**: Lint passed (0 warnings, 0 errors). TypeScript compiled with no errors.

## Current Status
- **Current Phase**: All phases complete
- **Progress**: 19/19

## Deferred Items
- Keyboard shortcuts / command palette
- Test suite setup
- Diff viewer integration (separate item exists)
- Feature page settings panel functionality
- Agent permission configuration UI
- Worktree cleanup on feature deletion
