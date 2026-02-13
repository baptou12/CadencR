# Plan: Feature plan sidebar with phase viewer

## Context
- Feature page (`src/renderer/routes/projects/$projectId/features/$featureId.tsx`) is a single-column layout with FeatureTopBar + agent panels
- Plans/phases are stored in SQLite (`plans` and `phases` tables) but no tRPC routes exist to fetch plan/phase data — only progress counts (`getProgress`)
- Phase schema: `id, plan_id, step_number, title, status, complexity, commit_message, prompt, order_index`
- Plan schema: `id, feature_id, title, status, raw_markdown, created_at, updated_at`
- `useDbUpdated` hook already invalidates on `phase` and `plan` entity changes
- shadcn/ui has `dialog`, `badge`, `button`, `scroll-area` — no `card` component yet
- Markdown rendering: no markdown component exists yet, will need `react-markdown`

## Clarifications
- **Layout**: Right panel split view — sidebar appears alongside existing agent panels
- **Phase status**: Icon + colored badge (circle=pending, spinner=running, checkmark=completed, X=error)
- **Card content**: Phase title, status, and a markdown preview of the phase prompt content
- **Real-time updates**: Yes, auto-refresh via `db:updated` IPC notifications
- **Fullscreen modal**: Each phase has a button to open full content in a dialog

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Lint passes | `pnpm run lint` | Exit code 0, no errors |
| TypeScript compiles | `npx tsc --noEmit` | Exit code 0, no type errors |
| Build succeeds | `pnpm run package` | Exit code 0, package completes |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1, 2   | tRPC route and markdown dep are independent |
| 2    | 3      | Phase card component depends on tRPC types and markdown |
| 3    | 4      | Sidebar component depends on phase card |
| 4    | 5      | Integration depends on sidebar component |

> **Parallelism**: Phases within the same step can run in parallel (max 4).

## Phases

### ⬜ Phase 1: Add tRPC route for plan with phases
- **Step**: 1
- **Complexity**: 2
- [ ] Add `getPlanWithPhases` query to `featuresRouter` in `src/main/trpc/features.ts` — takes `feature_id`, returns the latest plan row with all its phases (ordered by `step_number`, `order_index`)
- [ ] Add return type to `src/main/db/types.ts` if needed (e.g. `PlanWithPhases`)
- [ ] Update `useDbUpdated` hook to invalidate `features.getPlanWithPhases` on `phase` and `plan` entity changes
- **Files**: `src/main/trpc/features.ts`, `src/main/db/types.ts`, `src/renderer/hooks/useDbUpdated.ts`
- **Commit message**: `feat: add getPlanWithPhases tRPC query for plan sidebar`
- **Bisect note**: N/A — new query, no callers yet

### ⬜ Phase 2: Install react-markdown and create Markdown component
- **Step**: 1
- **Complexity**: 2
- [ ] Install `react-markdown` and `remark-gfm` packages
- [ ] Create `src/renderer/components/Markdown.tsx` — a thin wrapper around `react-markdown` with remark-gfm plugin, styled with Tailwind prose classes (use `prose-sm prose-invert dark:prose-invert` or similar to match app theme)
- **Files**: `package.json`, `src/renderer/components/Markdown.tsx`
- **Commit message**: `feat: add Markdown renderer component with GFM support`
- **Bisect note**: N/A — new component, no callers yet

### ⬜ Phase 3: Create PhaseCard component
- **Step**: 2
- **Complexity**: 3
- [ ] Create `src/renderer/components/PhaseCard.tsx`
- [ ] Props: phase data (title, status, complexity, step_number, prompt/markdown content), `onExpand` callback
- [ ] Display: status icon+badge (CircleIcon=pending, Loader2=running, CheckCircle2=completed/done, XCircle=error), phase title, truncated markdown preview (using Markdown component, limited height with overflow hidden)
- [ ] "Expand" button (MaximizeIcon from lucide) to trigger `onExpand`
- [ ] Fixed width card, compact layout suitable for sidebar
- **Files**: `src/renderer/components/PhaseCard.tsx`
- **Commit message**: `feat: add PhaseCard component with status icons and markdown preview`
- **Bisect note**: N/A — new component, no callers yet

### ⬜ Phase 4: Create PlanSidebar component with fullscreen modal
- **Step**: 3
- **Complexity**: 3
- [ ] Create `src/renderer/components/PlanSidebar.tsx`
- [ ] Takes `featureId` prop, queries `getPlanWithPhases`
- [ ] Renders plan title at top, then a vertical scrollable list of PhaseCard components
- [ ] Manages `expandedPhaseId` state — when set, opens a Dialog with full phase content (title, full markdown, status badge, complexity, commit message)
- [ ] Use `ScrollArea` from shadcn for the phase list
- [ ] If no plan exists, render nothing (return null) so the layout stays single-column
- **Files**: `src/renderer/components/PlanSidebar.tsx`
- **Commit message**: `feat: add PlanSidebar with scrollable phase list and fullscreen modal`
- **Bisect note**: N/A — new component, no callers yet

### ⬜ Phase 5: Integrate PlanSidebar into feature page
- **Step**: 4
- **Complexity**: 2
- [ ] Modify feature page layout: wrap existing content in a flex row — left side (flex-1, min-w-0) for current content, right side (fixed width ~320px) for `<PlanSidebar featureId={...} />`
- [ ] PlanSidebar returns null when no plan exists, so layout is unchanged for draft features
- [ ] Ensure the sidebar is full-height and independently scrollable (the main content area should still scroll independently)
- **Files**: `src/renderer/routes/projects/$projectId/features/$featureId.tsx`
- **Commit message**: `feat: integrate plan sidebar into feature page layout`
- **Bisect note**: Must include PlanSidebar import and usage together; layout change is self-contained

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Not started
- **Progress**: 0/5
