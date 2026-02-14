# Plan: Execute agent plan deviation tracking

## Context
The execute agent orchestrates phase execution via `execute-agent.ts`. Each phase runs as a Claude subprocess with an enriched prompt (plan context + previous phases). The system prompt in `agent-configs.ts` currently tells the agent to "follow the plan precisely." Phase status is tracked in the `phases` DB table but has no fields for implementation notes or deviations. The UI shows phases in `PlanSidebar.tsx` → `PhaseCard.tsx` with status, title, prompt, and commit message.

## Clarifications
- **Deviation reporting**: Add `implementation_notes` and `deviations` TEXT columns to phases table. Parse agent output for structured sections.
- **Deviation scope**: Minor only — fix unexpected issues (type errors, edge cases) but don't change the overall approach. Must document why.
- **UI visibility**: Show notes and deviations in the phase detail panel.
- **Completion conditions**: Lint + typecheck must pass.

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Lint passes | `pnpm run lint` | Exit code 0, no errors |
| TypeScript compiles | `npx tsc --noEmit` | Exit code 0, no type errors |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1      | DB migration adding new columns |
| 2    | 2      | Update system prompt to request structured output |
| 3    | 3      | Parse agent output and persist to DB in completion action |
| 4    | 4      | Show implementation notes and deviations in phase UI |
| 5    | 5      | Include implementation notes and deviations in enriched prompt for next phases |

> **Parallelism**: Sequential — each phase depends on the previous.

## Phases

### ✅ Phase 1: Add DB columns for deviation tracking
- **Step**: 1
- **Complexity**: 2
- [x] Add migration 14 in `src/main/db/migrations.ts`: `ALTER TABLE phases ADD COLUMN implementation_notes TEXT; ALTER TABLE phases ADD COLUMN deviations TEXT;`
- [x] Update `PhaseRow` interface in `src/main/db/types.ts` to include `implementation_notes: string | null` and `deviations: string | null`
- **Files**: `src/main/db/migrations.ts`, `src/main/db/types.ts`
- **Commit message**: `feat: add implementation_notes and deviations columns to phases table`
- **Bisect note**: N/A — new nullable columns, no callers yet
- **Implementation notes**: Added as migration 17 (not 14 as planned) since migrations 14-16 already exist. Two ALTER TABLE statements add nullable TEXT columns. PhaseRow interface updated with both fields as `string | null`.
- **Validation results**: Lint passes (0 warnings, 0 errors). TypeScript compiles with no errors.

### ✅ Phase 2: Update execute agent prompt for structured output
- **Step**: 2
- **Complexity**: 2
- [x] Update `EXECUTE_SYSTEM_PROMPT` in `src/main/agents/agent-configs.ts` to:
  - Allow minor deviations (fix type errors, edge cases, broken imports) but require documenting them
  - Instruct agent to output a structured section at the end of execution: `## Implementation Notes` (what was done) and `## Deviations` (what differed from plan and why)
  - Keep the tone: plan is primary guide, deviations are for unplanned issues only
- **Files**: `src/main/agents/agent-configs.ts`
- **Commit message**: `feat: update execute prompt to request implementation notes and deviations`
- **Bisect note**: N/A — prompt change only, no code depends on output format yet
- **Implementation notes**: Updated EXECUTE_SYSTEM_PROMPT with: (1) "Deviation Rules" section defining auto-fix vs stop-and-report categories, (2) "Structured Output" section with `---IMPLEMENTATION_NOTES_START---` / `---IMPLEMENTATION_NOTES_END---` delimiters containing Implementation Notes, Deviations, and Validation Results subsections. Also added a Validation Results section to the structured output for completeness.
- **Validation results**: Lint passes (0 warnings, 0 errors). TypeScript compiles with no errors.

### ✅ Phase 3: Parse agent output and persist deviations to DB
- **Step**: 3
- **Complexity**: 3
- [x] In `src/main/agents/execute-agent.ts`, in the phase completion action (where status is set to 'completed'), extract `## Implementation Notes` and `## Deviations` sections from the agent's message history
- [x] Use `ipc-bridge.ts` message store or agent session messages to get the agent's final output
- [x] Parse the sections using simple regex/string matching
- [x] Update the phase row with `implementation_notes` and `deviations` columns
- [x] Update the `getPlanWithPhases` query in `src/main/trpc/features.ts` to include the new columns in SELECT
- **Files**: `src/main/agents/execute-agent.ts`, `src/main/trpc/features.ts`
- **Commit message**: `feat: parse and persist implementation notes and deviations from execute agent`
- **Bisect note**: Must include both parsing and query update together — UI won't break (columns are nullable) but data should flow end-to-end
- **Implementation notes**: Used the `_output` parameter already available in the completion handler (accumulated agent output) rather than querying ipc-bridge message store. Added `parsePhaseOutput()` function that finds the last `---IMPLEMENTATION_NOTES_START---`/`---IMPLEMENTATION_NOTES_END---` block and extracts `## Implementation Notes` and `## Deviations` sections via regex. Updated the completed-phase UPDATE statement to set both columns. Updated `getPlanWithPhases` SELECT to include `implementation_notes, deviations`.
- **Validation results**: Lint passes (0 warnings, 0 errors). TypeScript compiles with no errors.

### ⬜ Phase 4: Display deviations in phase detail UI
- **Step**: 4
- **Complexity**: 3
- [ ] Update `PhaseData` interface in `PhaseCard.tsx` to include `implementation_notes` and `deviations`
- [ ] In the expanded phase modal in `PlanSidebar.tsx`, add sections below the prompt:
  - "Implementation Notes" section (rendered as markdown, only if non-null)
  - "Deviations" section with a distinct visual treatment (e.g., amber/warning color accent, only if non-null)
- [ ] Both sections should only appear for completed phases that have data
- **Files**: `src/renderer/components/PhaseCard.tsx`, `src/renderer/components/PlanSidebar.tsx`
- **Commit message**: `feat: display implementation notes and deviations in phase detail panel`
- **Bisect note**: N/A — nullable fields, gracefully hidden when null

### ⬜ Phase 5: Include deviations in enriched prompt for subsequent phases
- **Step**: 5
- **Complexity**: 2
- [ ] In `buildEnrichedPrompt()` in `src/main/agents/execute-agent.ts`, update the completed phases query to also SELECT `implementation_notes` and `deviations`
- [ ] Update the phase list formatting to include implementation notes and deviations below each completed phase (only when non-null)
- **Files**: `src/main/agents/execute-agent.ts`
- **Commit message**: `feat: include implementation notes and deviations in enriched prompt for next phases`
- **Bisect note**: N/A — additive prompt content, no breaking changes

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Phase 4
- **Progress**: 3/5
