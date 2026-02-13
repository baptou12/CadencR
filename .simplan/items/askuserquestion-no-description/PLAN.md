# Plan: AskUserQuestion tool doesn't show description

## Context
The `AgentQuestionDrawer` component (`src/renderer/components/AgentQuestionDrawer.tsx`) renders AskUserQuestion tool calls. Currently:

1. The `AgentQuestion` interface defines `options` as `string[]`
2. The `parseAskUserQuestions` function treats options as plain strings
3. But the AskUserQuestion tool sends options as `{label: string, description: string}` objects

The component renders options as horizontal pill buttons with no description text. The fix requires:
- Updating the data model to support `{label, description}` option objects
- Changing the layout from horizontal buttons to a vertical list
- Showing description text below each option label

## Clarifications
- **Layout**: Switch from horizontal button row to vertical list
- **Description display**: Show description as smaller muted text below each option label
- **Completion conditions**: lint + typecheck must pass

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Lint passes | `pnpm run lint` | Exit code 0 |
| Type check passes | `npx tsc --noEmit` | Exit code 0 |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1      | Update data model and parser |
| 2    | 2      | Update UI to vertical list with descriptions |

> **Parallelism**: Phases within the same step can run in parallel (max 4).

## Phases

### ⬜ Phase 1: Update AgentQuestion interface and parser
- **Step**: 1
- **Complexity**: 2
- [ ] Change `AgentQuestion.options` from `string[]` to `{label: string, description?: string}[]`
- [ ] Update `parseAskUserQuestions` to extract `label` and `description` from option objects (handle both object and string formats for backwards compat)
- [ ] Update `getCurrentAnswer` and submission logic to use `option.label` for the answer value
- [ ] Update all references to `option` as string to `option.label` in event handlers
- **Files**: `src/renderer/components/AgentQuestionDrawer.tsx`
- **Commit message**: `fix: update AgentQuestion options to support label+description objects`
- **Bisect note**: Must update interface, parser, and all usages in same phase to avoid type errors

### ⬜ Phase 2: Vertical list layout with descriptions
- **Step**: 2
- **Complexity**: 2
- [ ] Replace horizontal `flex-wrap` button row with vertical list layout
- [ ] Render each option as a selectable card/row: label as primary text, description as muted text below
- [ ] Style selected state with ring/border highlight
- [ ] Keep "Other..." option at the bottom of the list
- **Files**: `src/renderer/components/AgentQuestionDrawer.tsx`
- **Commit message**: `fix: vertical option list with descriptions in AskUserQuestion UI`
- **Bisect note**: N/A

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Not started
- **Progress**: 0/2
