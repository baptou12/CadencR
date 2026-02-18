# Plan: Smart permission system for agent tool calls

## Summary
Replace `bypassPermissions` with `acceptEdits` mode + `settingSources` + smart `canUseTool` callback. Auto-allow operations inside the worktree/`/tmp`, prompt for everything else. Store user approvals in `.claude/settings.local.json`.

## Context
- SDK permission evaluation order: Hooks → Permission rules (settings.json) → Permission mode → `canUseTool` callback
- With `bypassPermissions`, step 3 auto-approves everything so `canUseTool` is NEVER called
- SDK `settingSources` option (`'user' | 'project' | 'local'`) is currently NOT set — SDK loads NO settings files (isolation mode)
- `src/main/agents/subprocess-manager.ts` line 458: sets `permissionMode: "bypassPermissions"`, no `settingSources`
- `canUseTool` callback (lines 480-627): only handles `AskUserQuestion` and `ExitPlanMode`, allows everything else
- `ExitPlanMode` handler (line 585): switches to `bypassPermissions` after plan approval — must stay on `acceptEdits`
- Existing IPC pattern for user interaction: `requestUserAnswers()` (lines 872-905) broadcasts via IPC, waits on `questionEmitter`
- Renderer question UI: `AgentQuestionDrawer.tsx` with CMD+number shortcuts
- Tool input path fields: `Read/Write/Edit` → `file_path`, `Glob/Grep` → `path`, `Bash` → `command`, `NotebookEdit` → `notebook_path`
- Settings format: `{ "permissions": { "allow": ["Bash(git push:*)", "Read(//path/**)"] } }`
- DB column `pending_questions` on `agent_sessions` stores pending UI state — same pattern needed for `pending_permission`

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Tools inside worktree auto-allowed | Start a plan agent, observe it reads files without prompting | No permission prompts for worktree files |
| Tools outside worktree prompt user | Agent tries to read `/workspace/something` | Permission prompt appears in UI |
| git push always denied | Agent runs `git push` in Bash | Tool call denied with feedback |
| "Allow for future" persists | Approve a tool, check worktree `.claude/settings.local.json` | Pattern added to `permissions.allow[]` |
| Existing settings respected | Pre-add an allow rule, start agent | Tool auto-allowed without prompt |
| App builds | `pnpm run lint` | No lint errors |

## Phases

### ✅ Phase 1: Permission resolution module
- **Step**: 1
- **Complexity**: 3
- **Tasks**:
  - [x] Create `src/main/agents/permissions.ts` with:
    - [x] `resolvePermission(toolName, input, worktreePath, sessionCache)` — extracts paths from tool input, checks if within worktree or `/tmp`, detects `git push`, returns `"allow"` or `{ needs_prompt: true, description, pattern }`
    - [x] `appendToSettingsLocal(worktreePath, pattern)` — reads/creates `<worktree>/.claude/settings.local.json`, appends pattern to `permissions.allow[]`, writes back
    - [x] Path extraction helpers per tool type (file_path, path, command parsing)
  - [x] Path checking: `path.resolve()` must start with `worktreePath` or `/tmp/`
  - [x] For Bash: scan `input.command` for absolute paths outside worktree and detect `git push`
  - [x] Non-path tools (WebSearch, WebFetch, MCP tools): auto-allow
- **Files**: src/main/agents/permissions.ts
- **Commit message**: feat: add permission resolution module for agent tool calls
- **Implementation notes**: Created `src/main/agents/permissions.ts` with all specified functions. Key design decisions: (1) `isPathAllowed` normalizes both worktree and target paths via `path.resolve()` and checks prefix with `path.sep` to avoid partial matches. (2) Bash analysis uses regex `/\bgit\s+push\b/` for git push detection and a path regex to find absolute paths in commands. (3) Relative paths in tool inputs are resolved against the worktree. (4) `sessionCache` (a `Set<string>`) allows callers to track session-scoped approvals by pattern. (5) `appendToSettingsLocal` creates `.claude/` directory if needed and preserves existing settings content. (6) MCP tools (prefixed `mcp__`) and non-path tools (WebSearch, WebFetch, AskUserQuestion, ExitPlanMode, TodoRead, TodoWrite) are always auto-allowed. (7) Unknown tools are auto-allowed to avoid blocking SDK-internal tools.
- **Validation results**: `pnpm run lint` passed with 0 warnings and 0 errors. Integration-level completion conditions (agent prompts, UI prompts, settings persistence) require later phases to be wired up and will be validated end-to-end then.

### Phase 2: Switch subprocess-manager to default mode with canUseTool
- **Step**: 2
- **Complexity**: 4
- **Tasks**:
  - In `src/main/agents/subprocess-manager.ts`:
    - Change `permissionMode` from `"bypassPermissions"` to `"acceptEdits"` (line 458)
    - Add `settingSources: ['user', 'project', 'local']` to query options
    - Add `worktreePath` to `SubprocessOptions` interface and store on managed subprocess object
    - Add `cachedPermissions: string[]` to managed subprocess for session-scoped approvals
    - Expand `canUseTool` callback: before existing `AskUserQuestion`/`ExitPlanMode` handlers, call `resolvePermission()`. If `"allow"` → return allow. If `denied` → return deny with reason as feedback. If `needs_prompt` → call new `requestToolPermission()` function. Handle allow_once, allow_future (write to settings.local.json + cache), deny (with feedback message)
    - Add `requestToolPermission()` function (mirrors `requestUserAnswers()`): broadcast via `agent:tool-permission` IPC channel, wait on `questionEmitter` `permission:{id}` event
    - Fix `ExitPlanMode` handler: keep `acceptEdits` mode instead of switching to `bypassPermissions`
  - Pass `worktreePath` from `SubprocessOptions` through all call sites (unified-agent.ts, router.ts)
  - Add `worktreePath` to `SubprocessOptions` type in subprocess-manager.ts
- **Files**: src/main/agents/subprocess-manager.ts, src/main/agents/unified-agent.ts, src/main/agents/types.ts
- **Commit message**: feat: replace bypassPermissions with smart canUseTool permission system

### Phase 3: Pass worktree path through agent configs and router
- **Step**: 2
- **Complexity**: 2
- **Tasks**:
  - Update `UnifiedAgentConfig` type in `src/main/agents/types.ts` to include `worktreePath?: string`
  - Update `startUnifiedAgent()` in `src/main/agents/unified-agent.ts` to pass `config.worktreePath` to `startSubprocess()`
  - Update all agent config factories in `src/main/agents/agent-configs.ts` to accept and forward `worktreePath`
  - Update all `start*` mutations in `src/main/trpc/router.ts` to pass `worktreePath` (from `resolveAgentCwd` result or worktree setting)
  - Update `continueExecuteAgent` in `src/main/agents/execute-agent.ts` to pass `worktreePath`
- **Files**: src/main/agents/types.ts, src/main/agents/unified-agent.ts, src/main/agents/agent-configs.ts, src/main/trpc/router.ts, src/main/agents/execute-agent.ts
- **Commit message**: feat: thread worktree path through agent config pipeline

### Phase 4: DB migration and IPC for permission prompts
- **Step**: 3
- **Complexity**: 2
- **Tasks**:
  - Add migration in `src/main/db/migrations.ts`: `ALTER TABLE agent_sessions ADD COLUMN pending_permission TEXT`
  - Add `onToolPermission`/`offToolPermission` IPC handlers in `src/preload.ts` (same pattern as `onAskUserQuestion`)
  - Add `submitToolPermission` tRPC endpoint in `src/main/trpc/router.ts`: accepts `{ subprocessId, decision: "allow_once"|"allow_future"|"deny", feedback?: string }`, emits on `questionEmitter`
  - In `requestToolPermission()`: persist pending_permission to DB before broadcasting (same as pending_questions pattern), clear on response
- **Files**: src/main/db/migrations.ts, src/preload.ts, src/main/trpc/router.ts, src/main/agents/subprocess-manager.ts
- **Commit message**: feat: add IPC and DB support for permission prompts

### Phase 5: Renderer permission prompt UI
- **Step**: 4
- **Complexity**: 3
- **Tasks**:
  - Create `src/renderer/components/ToolPermissionPrompt.tsx`: inline component showing tool name, description of what it's trying to do, three options with CMD+number shortcuts (CMD+1 allow once, CMD+2 allow future, CMD+3 deny with text input for feedback)
  - Update `src/renderer/hooks/useFeatureAgentState.ts` to parse `pending_permission` from agent session state (same pattern as `pending_questions`)
  - Integrate `ToolPermissionPrompt` into agent session display (same location as `AgentQuestionDrawer`)
  - Wire up `submitToolPermission` tRPC mutation from the permission prompt component
- **Files**: src/renderer/components/ToolPermissionPrompt.tsx, src/renderer/hooks/useFeatureAgentState.ts, src/renderer/components/AgentSession.tsx
- **Commit message**: feat: add permission prompt UI with CMD+number shortcuts
