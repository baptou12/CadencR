# Plan: Better plans for execution

## Context
The ProductDevR Electron app has a plan/execute agent pipeline:
- **Plan agent** (`src/main/agents/plan-agent.ts`): Explores codebase, asks questions, outputs a structured plan between `---PLAN_START---`/`---PLAN_END---` markers. Parsed by `parsePlanOutput()` into title + phases.
- **Execute agent** (`src/main/agents/execute-agent.ts`): Receives each phase's `prompt` field (raw phase body text) and implements it.
- **DB**: `plans` table has `raw_markdown`, `phases` table has `prompt` (phase body text). Types in `src/main/db/types.ts`.
- **Migrations**: `src/main/db/migrations.ts` — currently at version 11.

Current plan format only has `## Summary` and `## Phases`. The phase `prompt` sent to the executor is just the raw phase markdown body — no broader context.

## Clarifications
- **New plan sections**: Add Context, Clarifications, Completion Conditions to the plan format and store them as new DB columns on the `plans` table.
- **Executor prompt enrichment**: Each phase execution should receive: summary, context, clarifications, completion conditions, AND previously completed phases (for context). Do NOT send future phases or parallel phases.
- **Scope**: Plan agent prompt, execute agent prompt, plan parser, DB schema, types.

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Lint passes | `pnpm run lint` | Exit code 0 |
| Type check passes | `pnpm run typecheck` | Exit code 0, no errors |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1      | DB migration + types — foundation for new columns |
| 2    | 2      | Plan agent prompt + parser — produce richer plans |
| 3    | 3      | Execute agent — consume richer context when running phases |

> **Parallelism**: All phases are sequential (each depends on the previous).

## Phases

### ✅ Phase 1: Add plan-level context columns to DB
- **Step**: 1
- **Complexity**: 2
- [x] Add migration 12 to `src/main/db/migrations.ts`: ALTER TABLE plans ADD COLUMN `summary` TEXT, `context` TEXT, `clarifications` TEXT, `completion_conditions` TEXT
- [x] Update `PlanRow` in `src/main/db/types.ts` to include `summary`, `context`, `clarifications`, `completion_conditions` (all `string | null`)
- **Files**: `src/main/db/migrations.ts`, `src/main/db/types.ts`
- **Commit message**: `feat: add plan-level context columns to plans table`
- **Bisect note**: N/A — new nullable columns, no code reads them yet
- **Implementation notes**: Added migration 12 with four separate ALTER TABLE statements (SQLite requires one column per ALTER). Added four `string | null` fields to `PlanRow` between `raw_markdown` and `created_at`.
- **Validation results**: Lint passes (0 errors). Typecheck passes (npx tsc --noEmit, exit 0). Note: `pnpm run typecheck` script does not exist; used `npx tsc --noEmit` directly.

### ⬜ Phase 2: Enrich plan agent prompt and parser
- **Step**: 2
- **Complexity**: 3
- [ ] Update `PLAN_SYSTEM_PROMPT` in `plan-agent.ts` to instruct the agent to output these new sections between the `---PLAN_START---`/`---PLAN_END---` markers:
  - `## Summary` (already exists)
  - `## Context` — what the agent learned about the codebase
  - `## Clarifications` — Q&A from the user
  - `## Completion Conditions` — table with Condition / Validation Command / Expected Outcome (or "None specified")
  - `## Phases` (already exists)
- [ ] Update `parsePlanOutput()` to extract the new sections from the markdown. Add fields to `ParsedPlan`: `summary`, `context`, `clarifications`, `completionConditions` (all `string | null`)
- [ ] In `setupPlanCompletionHandler`, store the parsed sections into the new DB columns when saving the plan
- **Files**: `src/main/agents/plan-agent.ts`
- **Commit message**: `feat: enrich plan agent prompt with context, clarifications, and completion conditions`
- **Bisect note**: Depends on Phase 1 columns existing. Parser changes are backward-compatible (new fields are optional).

### ⬜ Phase 3: Enrich execute agent prompts with plan context
- **Step**: 3
- **Complexity**: 3
- [ ] In `execute-agent.ts`, when building the phase prompt in `executePhase()`:
  - Read the plan's `summary`, `context`, `clarifications`, `completion_conditions` from DB
  - Query previously completed phases for the same plan (status = 'completed', step_number < current phase's step_number)
  - Build an enriched prompt that includes: plan-level context sections, then completed phase summaries, then the current phase body
- [ ] Update `EXECUTE_SYSTEM_PROMPT` to mention that plan context, clarifications, and completion conditions are provided, and that previously completed phases are listed for reference
- [ ] If completion conditions are present, instruct the executor to run validation commands after implementation and iterate (max 3 attempts)
- **Files**: `src/main/agents/execute-agent.ts`
- **Commit message**: `feat: enrich execute agent prompts with plan context and completed phases`
- **Bisect note**: Depends on Phase 2 for populated DB columns. Falls back gracefully if columns are null (old plans).

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Phase 2
- **Progress**: 1/3
