# Plan: Project-level settings configuration

## Context
The backend infrastructure for project-level settings already exists:
- `project_settings` DB table (migration 8)
- tRPC endpoints: `projects.getSettings`, `projects.setSetting`, `projects.getModelSettings`, `projects.setModelSetting`
- `ModelSelector` component already supports `level="project"` with `projectId` prop
- Model resolution already cascades: feature → project → global → default

The only missing piece is the **UI** to access project settings. Currently the `...` menu on each project in `ProjectList.tsx` only has "Delete Project".

Feature-level settings use a `Popover` from a gear icon in `FeatureTopBar.tsx` showing `ModelSelector`. The same pattern should be used for project settings, but triggered from the project `...` dropdown menu.

## Clarifications
- **UI pattern**: Popover from the `...` menu dropdown
- **Settings scope**: Match feature-level (models for 5 agent types, auto_commit, branch_prefix) minus worktree-specific stuff
- **Completion conditions**: Lint + typecheck must pass

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Lint passes | `pnpm run lint` | Exit code 0, 0 errors |
| Typecheck passes | `npx tsc --noEmit` | Exit code 0, no errors |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1      | Add settings popover to project dropdown menu |

> **Parallelism**: Single step, single phase.

## Phases

### ⬜ Phase 1: Add project settings popover to project list dropdown
- **Step**: 1
- **Complexity**: 3
- [ ] Add a "Settings" `DropdownMenuItem` to the project `...` menu in `ProjectList.tsx`
- [ ] Use a `Popover` (or `Dialog`) triggered from the menu item to show project settings
- [ ] Inside the popover, render `ModelSelector` with `level="project"` and the project's `projectId`
- [ ] Add branch_prefix and auto_commit settings fields (text input for prefix, toggle for auto_commit) using `projects.getSettings` / `projects.setSetting` tRPC calls
- [ ] Ensure popover alignment works within the sidebar layout (may need `side="right"` or a Dialog if space is tight)
- **Files**: `src/renderer/components/ProjectList.tsx`
- **Commit message**: `feat: add project-level settings popover to project dropdown menu`
- **Bisect note**: Self-contained — adds new UI using existing backend endpoints

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Not started
- **Progress**: 0/1
