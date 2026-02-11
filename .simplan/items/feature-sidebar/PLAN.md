# Plan: Feature Sidebar

## Context
- Electron app with React 19, Tailwind v4, TanStack Router (hash-based, file-based routes)
- SQLite via better-sqlite3 with migration system (version-based, currently at v1 with settings table)
- tRPC v10 over electron-trpc IPC for main↔renderer communication
- Current sidebar is inline in `__root.tsx` with simple nav links (Home, Settings)
- shadcn/ui configured but no components installed yet
- Path alias: `@/*` → `src/renderer/*`

## Clarifications
- **Sidebar replaces** current nav entirely
- **Layout**: Flat project list (top ~33% height), feature list below for selected project
- **Scope**: Both projects and features tables + UI
- **Projects**: name + path fields
- **Features**: title + status (draft, planned, in-progress, to-test, done), linked to a project
- **Sorting/filtering**: Filter features by status, sort by creation date
- **No drag-and-drop**: Not needed
- **UI**: shadcn/ui components

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Type check | `npx tsc --noEmit` | Exit code 0, no errors |
| Build passes | `npm run package -- --platform=darwin` | Exit code 0, build succeeds |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1      | Database migration for projects + features tables |
| 2    | 2      | tRPC routers for projects and features CRUD |
| 3    | 3      | Install shadcn/ui components needed for sidebar |
| 4    | 4, 5   | Project list component and feature list component (independent UI) |
| 5    | 6      | Integrate sidebar into root layout, replacing current nav |

> **Parallelism**: Phases within the same step can run in parallel (max 4).

## Phases

### ✅ Phase 1: Database migration for projects and features
- **Step**: 1
- **Complexity**: 2
- [x] Add migration v2: create `projects` table (id INTEGER PK autoincrement, name TEXT NOT NULL, path TEXT NOT NULL, created_at TEXT DEFAULT datetime('now'))
- [x] Add migration v3: create `features` table (id INTEGER PK autoincrement, project_id INTEGER NOT NULL FK→projects, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_at TEXT DEFAULT datetime('now'))
- **Files**: `src/main/db/migrations.ts`
- **Commit message**: `feat: add projects and features database tables`
- **Bisect note**: N/A — migrations only run on app start, no callers yet
- **Implementation notes**: Added migration v2 (projects) and v3 (features) to the migrations array. Both use `datetime('now')` for created_at defaults and features has a foreign key to projects.
- **Validation results**: `npx tsc --noEmit` passed (exit 0). `npm run package -- --platform=darwin` passed (exit 0).

### ⬜ Phase 2: tRPC routers for projects and features
- **Step**: 2
- **Complexity**: 3
- [ ] Create `src/main/trpc/projects.ts` with CRUD procedures: list, create (name, path), delete (id)
- [ ] Create `src/main/trpc/features.ts` with procedures: listByProject (project_id, optional status filter, sorted by created_at desc), create (project_id, title), updateStatus (id, status), delete (id)
- [ ] Add both sub-routers to appRouter in `src/main/trpc/router.ts`
- **Files**: `src/main/trpc/projects.ts`, `src/main/trpc/features.ts`, `src/main/trpc/router.ts`
- **Commit message**: `feat: add tRPC routers for projects and features CRUD`
- **Bisect note**: Routers added but not called from UI yet — safe

### ⬜ Phase 3: Install shadcn/ui components
- **Step**: 3
- **Complexity**: 1
- [ ] Install shadcn/ui components: button, scroll-area, badge, dialog, input, select, separator
- **Files**: `src/renderer/components/ui/*.tsx` (generated), `package.json`
- **Commit message**: `chore: install shadcn/ui components for sidebar`
- **Bisect note**: N/A — just adding unused component files

### ⬜ Phase 4: Project list component
- **Step**: 4
- **Complexity**: 3
- [ ] Create `src/renderer/components/ProjectList.tsx` — scrollable list of projects with selected state, "Add project" button that opens a dialog (name + folder path inputs)
- [ ] Use tRPC `projects.list` and `projects.create` queries/mutations
- [ ] Highlight selected project, call `onSelectProject(id)` callback
- [ ] Include delete option per project
- **Files**: `src/renderer/components/ProjectList.tsx`
- **Commit message**: `feat: add project list component with create/delete`
- **Bisect note**: Standalone component, not mounted yet

### ⬜ Phase 5: Feature list component
- **Step**: 4
- **Complexity**: 3
- [ ] Create `src/renderer/components/FeatureList.tsx` — scrollable list of features for a given project_id
- [ ] Status filter (select/dropdown): all, draft, planned, in-progress, to-test, done
- [ ] Sorted by creation date (newest first, from DB)
- [ ] Status badge with color per status
- [ ] "Add feature" button → dialog with title input
- [ ] Click feature to select, status change dropdown per feature
- [ ] Include delete option per feature
- **Files**: `src/renderer/components/FeatureList.tsx`
- **Commit message**: `feat: add feature list component with filtering and status`
- **Bisect note**: Standalone component, not mounted yet

### ⬜ Phase 6: Integrate sidebar into root layout
- **Step**: 5
- **Complexity**: 3
- [ ] Create `src/renderer/components/Sidebar.tsx` composing ProjectList (top ~33%) + FeatureList (bottom ~67%) with a separator
- [ ] Manage selected project state, pass project_id to FeatureList
- [ ] Replace current nav in `__root.tsx` with `<Sidebar />` component
- [ ] Keep Settings link (as icon/gear button in sidebar header or footer)
- **Files**: `src/renderer/components/Sidebar.tsx`, `src/renderer/routes/__root.tsx`
- **Commit message**: `feat: integrate sidebar into root layout replacing nav`
- **Bisect note**: This is the integration phase — must include both the component and the layout change together

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Phase 2
- **Progress**: 1/6
