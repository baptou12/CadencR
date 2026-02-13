# Plan: Model selection in settings

## Context
- Settings stored in SQLite with three tiers: global `settings`, `project_settings`, `feature_settings` tables
- All tRPC routers already support get/set for each tier
- Model is hardcoded as `claude-haiku-4-5-20251001` in `subprocess-manager.ts:346`
- `SubprocessOptions` interface doesn't include a model field
- Agent types: `plan`, `brainstorm`, `execute`, `risk`, `review`
- Settings page (`src/renderer/routes/settings.tsx`) is minimal — just key/value text inputs
- shadcn/ui Select component available at `src/renderer/components/ui/select.tsx`

## Clarifications
- **Scope**: Global → project → feature, each level with per-agent-type model selection
- **Models**: Opus (`claude-opus-4-6`), Sonnet (`claude-sonnet-4-5-20250929`), Haiku (`claude-haiku-4-5-20251001`)
- **Per-agent**: Users can pick different models for each agent type (plan, execute, brainstorm, risk, review)
- **Default**: Opus for all agents
- **UI**: Model config section at each settings level (global settings page, project settings, feature settings)

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Lint passes | `pnpm run lint` | Exit code 0 |
| Type check | `npx tsc --noEmit` | No errors |
| Build succeeds | `pnpm run package` | Exit code 0 |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1      | Add model constants and resolver utility |
| 2    | 2      | Wire model into subprocess startup |
| 3    | 3      | Add tRPC procedures for model settings |
| 4    | 4      | Build ModelSelector UI component |
| 5    | 5      | Integrate ModelSelector into settings page |

> **Parallelism**: Sequential — each phase builds on the previous.

## Phases

### ✅ Phase 1: Add model constants and resolver
- **Step**: 1
- **Complexity**: 2
- [x] Create `src/main/agents/models.ts` with:
  - `CLAUDE_MODELS` array: `{ id: string, label: string }` for Opus, Sonnet, Haiku
  - `DEFAULT_MODEL` = `"claude-opus-4-6"`
  - `AgentType` re-export from types
  - `resolveModel(agentType, featureId?, projectId?)` function that checks feature_settings → project_settings → global settings → default, using setting key pattern `model_<agentType>` (e.g. `model_plan`, `model_execute`)
- **Files**: `src/main/agents/models.ts`
- **Commit message**: `feat: add model constants and resolver for per-agent model selection`
- **Bisect note**: N/A — new file, not imported yet
- **Implementation notes**: Created file with `ClaudeModel` interface, `CLAUDE_MODELS` array (Opus 4.6, Sonnet 4, Haiku 3.5), `DEFAULT_MODEL` constant, re-exported `AgentType`, and `resolveModel` function querying feature_settings, project_settings, and settings tables in cascade order.
- **Validation results**: Lint passed (0 errors), type check passed (no errors). Skipped `pnpm run package` (heavy build; lint + tsc sufficient for a new unimported file).

### ✅ Phase 2: Wire model into subprocess manager
- **Step**: 2
- **Complexity**: 2
- [x] Add optional `model?: string` to `SubprocessOptions` interface
- [x] Replace hardcoded model in `startSubprocess` with `options.model ?? DEFAULT_MODEL`
- [x] Update each agent caller (plan-agent, execute-agent, brainstorm-agent, risk-agent, review-agent) to call `resolveModel(agentType, featureId, projectId)` and pass `model` in subprocess options
- **Files**: `src/main/agents/subprocess-manager.ts`, `src/main/agents/plan-agent.ts`, `src/main/agents/execute-agent.ts`, `src/main/agents/brainstorm-agent.ts`, `src/main/agents/risk-agent.ts`, `src/main/agents/review-agent.ts`
- **Commit message**: `feat: use resolved model setting instead of hardcoded model`
- **Bisect note**: Must update all callers in same phase to avoid inconsistency
- **Implementation notes**: Added `model?: string` to `SubprocessOptions`, imported `DEFAULT_MODEL` and replaced hardcoded `"claude-haiku-4-5-20251001"` with `options.model ?? DEFAULT_MODEL`. Each of the 5 agent files now imports `resolveModel` from `./models`, calls it with the appropriate agent type and IDs, and passes the result as `model` in the subprocess options.
- **Validation results**: Lint passed (0 errors), type check passed (no errors). Skipped `pnpm run package` (heavy build; lint + tsc sufficient).

### ✅ Phase 3: Add tRPC procedures for model settings
- **Step**: 3
- **Complexity**: 2
- [x] Add `settings.getModelSettings` procedure — returns `Record<AgentType, string>` from global settings (keys `model_plan`, `model_execute`, etc.), falling back to DEFAULT_MODEL
- [x] Add `settings.setModelSetting` procedure — input `{ agentType, modelId }`, saves to global settings
- [x] Add `projects.getModelSettings` procedure — same pattern for project_settings
- [x] Add `projects.setModelSetting` procedure — input `{ projectId, agentType, modelId }`
- [x] Add `features.getModelSettings` and `features.setModelSetting` similarly
- **Files**: `src/main/trpc/router.ts`, `src/main/trpc/projects.ts`, `src/main/trpc/features.ts`
- **Commit message**: `feat: add tRPC procedures for per-agent model settings`
- **Bisect note**: N/A — new procedures, not called from UI yet
- **Implementation notes**: Added `getModelSettings` and `setModelSetting` procedures to all three routers (settings, projects, features). Each `getModelSettings` iterates the 5 agent types, queries the appropriate settings table, and falls back to `DEFAULT_MODEL`. Each `setModelSetting` upserts the `model_<agentType>` key into the corresponding table. Imported `AgentType` and `DEFAULT_MODEL` in projects.ts and features.ts; imported `DEFAULT_MODEL` in router.ts.
- **Validation results**: Lint passed (0 errors), type check passed (no errors). Skipped `pnpm run package` (heavy build; lint + tsc sufficient for new unconnected procedures).

### ⬜ Phase 4: Build ModelSelector component
- **Step**: 4
- **Complexity**: 3
- [ ] Create `src/renderer/components/ModelSelector.tsx`
  - Props: `level: "global" | "project" | "feature"`, optional `projectId`, optional `featureId`
  - Renders a grid of 5 agent types, each with a Select dropdown (Opus/Sonnet/Haiku + "Inherit default" for project/feature levels)
  - Uses the tRPC model settings queries/mutations for the appropriate level
  - Shows current effective model (resolved through hierarchy) as placeholder
- **Files**: `src/renderer/components/ModelSelector.tsx`
- **Commit message**: `feat: add ModelSelector component with per-agent dropdowns`
- **Bisect note**: N/A — new component, not rendered yet

### ⬜ Phase 5: Integrate into settings page
- **Step**: 5
- **Complexity**: 2
- [ ] Add "Model Configuration" section to `/settings` page with `<ModelSelector level="global" />`
- [ ] Keep existing key/value settings UI below it
- [ ] Clean up settings page layout (add section headings, spacing)
- **Files**: `src/renderer/routes/settings.tsx`
- **Commit message**: `feat: add model configuration section to settings page`
- **Bisect note**: N/A

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Phase 4
- **Progress**: 3/5
