# Plan: Auto-name features using Haiku

## Context

Features in ProductDevR come in two types: `feature` (planning workflow) and `session` (interactive Claude conversations). Currently:

- **Sessions** auto-name as "Session X" via `createSession` in `features.ts`
- **Features** require manual title entry via a dialog in `FeatureList.tsx`
- There is **no `updateTitle` procedure** — titles are set at creation and never updated
- The app uses Claude CLI subprocess (via `@anthropic-ai/claude-agent-sdk`) for all AI interactions
- The first user input arrives via `startPlan` (description param) or `startSession` (prompt param) in `router.ts`

Key files:
- `src/main/trpc/features.ts` — Feature CRUD (no title update)
- `src/main/trpc/router.ts` — Agent start procedures (`startPlan`, `startSession`, `startBrainstorm`)
- `src/renderer/components/FeatureList.tsx` — Feature creation UI (dialog + session creation)
- `src/main/agents/subprocess-manager.ts` — Claude CLI subprocess management
- `src/main/agents/unified-agent.ts` — Unified agent orchestration

## Clarifications

**Q: How should auto-naming work without a description field?**
A: All features (both sessions and planning) should be auto-named "Session X" on creation. When the user provides their first input (planning description or first session prompt), a lightweight Haiku agent generates a concise name. No tools — just text output.

**Q: API approach?**
A: Use existing Claude CLI subprocess pattern. No API key needed.

**Q: Should planning features also be auto-named?**
A: Yes — all feature types start as "Session X" and get renamed from first user input.

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Lint passes | `pnpm run lint` | Exit code 0 |
| Type check passes | `npx tsc --noEmit` | Exit code 0, no errors |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1, 2   | Backend: add updateTitle procedure + auto-naming service (independent) |
| 2    | 3      | Integration: hook auto-naming into startPlan/startSession/startBrainstorm |
| 3    | 4      | Frontend: change feature creation to auto-name "Session X" |

> **Parallelism**: Phases within the same step can run in parallel (max 4).

## Phases

### ✅ Phase 1: Add updateTitle tRPC procedure
- **Step**: 1
- **Complexity**: 1
- [x] Add `updateTitle` mutation to `featuresRouter` in `src/main/trpc/features.ts` accepting `{ id: number, title: string }`
- [x] Simple SQL: `UPDATE features SET title = ? WHERE id = ?`
- **Files**: `src/main/trpc/features.ts`
- **Commit message**: `feat: add updateTitle mutation to features router`
- **Bisect note**: N/A — new procedure, no callers yet
- **Implementation notes**: Added `updateTitle` mutation after `updateStatus` in the features router. Accepts `{ id: number, title: string }`, runs `UPDATE features SET title = ? WHERE id = ?`, returns `{ success: true }`.
- **Validation results**: Lint passed (0 warnings, 0 errors). Type check passed (no errors).

### ✅ Phase 2: Create auto-naming service using Claude CLI
- **Step**: 1
- **Complexity**: 3
- [x] Create `src/main/agents/auto-name.ts` with an `autoNameFeature(featureId: number, userInput: string, cwd: string)` function
- [x] Use `startSubprocess` from subprocess-manager to run a lightweight Haiku query with no tools
- [x] System prompt: "Generate a concise feature name (3-7 words) based on the user's description. Output ONLY the name, nothing else."
- [x] Listen for the text output, parse the name, then call `UPDATE features SET title = ? WHERE id = ?` directly
- [x] Use model `claude-haiku-3-5-20241022` hardcoded (this is a utility, not a user-configurable agent)
- [x] Fire-and-forget — don't block the main agent startup. Broadcast a custom event so the renderer can invalidate the features query when the name is ready
- **Files**: `src/main/agents/auto-name.ts`
- **Commit message**: `feat: add auto-naming service using Haiku via Claude CLI`
- **Bisect note**: N/A — new file, no callers yet
- **Implementation notes**: Created `src/main/agents/auto-name.ts`. Uses `startSubprocess` with `allowedTools: []` and hardcoded Haiku model. Listens for both `content_block_start` (text) and `content_block_delta` (text_delta) events to accumulate output. On completion, strips surrounding quotes from the name, updates the DB, and broadcasts `db:updated` with entity `"feature"` so the renderer invalidates via existing IPC channel.
- **Validation results**: Lint passed (0 warnings, 0 errors). Type check passed (no errors).

### ⬜ Phase 3: Hook auto-naming into agent start procedures
- **Step**: 2
- **Complexity**: 2
- [ ] In `router.ts`, after calling `startPlanAgent` / `startBrainstormAgent` / `startSessionAgent`, call `autoNameFeature(featureId, description/prompt, cwd)` fire-and-forget
- [ ] Only trigger if the feature title still matches the "Session X" pattern (avoid renaming user-titled features)
- [ ] Add the custom event listener in the renderer to invalidate the features query when `feature_renamed` event arrives (via existing IPC agent:event channel)
- **Files**: `src/main/trpc/router.ts`, `src/main/agents/auto-name.ts` (add event broadcast), `src/renderer/components/FeatureList.tsx` (listen for rename event)
- **Commit message**: `feat: trigger auto-naming on first agent interaction`
- **Bisect note**: Must include both the call site and the event listener to avoid stale UI

### ⬜ Phase 4: Change feature creation to auto-name "Session X"
- **Step**: 3
- **Complexity**: 2
- [ ] Modify `features.create` mutation to auto-generate "Session X" title (same pattern as `createSession`) instead of requiring a user-provided title — make `title` optional in the input schema
- [ ] Remove the title input dialog from `FeatureList.tsx` — "New Feature" should behave like "New Session" (instant creation, auto-name, navigate to feature)
- [ ] Update `createSession` to use the same unified counter so numbering is consistent across both types (query MAX across both feature types)
- **Files**: `src/main/trpc/features.ts`, `src/renderer/components/FeatureList.tsx`
- **Commit message**: `feat: auto-name all features as "Session X" on creation`
- **Bisect note**: Must update both backend and frontend together to avoid broken dialog flow

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Phase 3
- **Progress**: 2/4
