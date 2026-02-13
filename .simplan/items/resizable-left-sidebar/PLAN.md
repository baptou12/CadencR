# Plan: Resizable left sidebar

## Context
- Layout is in `__root.tsx`: flex row with `<Sidebar />` (fixed `w-64`/256px) + `<main className="flex-1">`.
- `PlanSidebar` (fixed `w-80`/320px) renders inside the feature detail route, not the root layout.
- Settings are persisted via SQLite `settings` table with `trpc.settings.get`/`trpc.settings.set`.
- shadcn/ui is installed (new-york style, neutral base). No resizable component yet.
- Tailwind CSS v4 with `@` alias mapping to `src/renderer/`.

## Clarifications
- **Scope**: Both left and right sidebars resizable.
- **Approach**: shadcn/ui resizable component (react-resizable-panels).
- **Left sidebar**: 180px min, 400px max, default 256px.
- **Right sidebar**: 240px min, 600px max, default 320px. Includes a collapse/expand toggle button.
- **Persistence**: Both widths (and right sidebar collapsed state) saved to settings table.

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Lint passes | `pnpm run lint` | Exit code 0 |
| Types check | `npx tsc --noEmit` | Exit code 0, no errors |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1      | Install dependency and add shadcn resizable component |
| 2    | 2      | Refactor root layout to use ResizablePanelGroup for left sidebar |
| 3    | 3      | Refactor feature detail to use resizable right sidebar with collapse toggle |
| 4    | 4      | Persist both sidebar widths and collapsed state to settings |

> **Parallelism**: Sequential — each phase builds on the previous.

## Phases

### ✅ Phase 1: Add shadcn resizable component
- **Step**: 1
- **Complexity**: 1
- [x] Install `react-resizable-panels` dependency
- [x] Add shadcn `resizable` UI component files (`ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle`)
- **Files**: `package.json`, `src/renderer/components/ui/resizable.tsx`
- **Commit message**: `feat: add shadcn resizable component`
- **Bisect note**: N/A — only adds files, nothing uses them yet
- **Implementation notes**: Installed `react-resizable-panels` v4.6.2. Adapted the shadcn resizable component for v4 API which uses `Group`, `Panel`, `Separator` exports (not `PanelGroup`, `Panel`, `PanelResizeHandle` as in v2/v3). Component re-exports as `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle` for consistent shadcn naming.
- **Validation results**: Lint passes (exit 0), TypeScript type check passes (exit 0, no errors).

### ✅ Phase 2: Resizable left sidebar in root layout
- **Step**: 2
- **Complexity**: 3
- [x] Wrap `<Sidebar />` and `<main>` in `ResizablePanelGroup` with `direction="horizontal"` in `__root.tsx`
- [x] Replace `w-64` on Sidebar with flex-based sizing from `ResizablePanel` (remove fixed width, use `defaultSize` as percentage)
- [x] Add `ResizableHandle` between sidebar and main panels
- [x] Set min/max constraints: 180px min, 400px max (use `minSize`/`maxSize` as percentages or pixel-based collapsedSize)
- [x] Style the resize handle to match the app theme (thin vertical line, cursor: col-resize)
- **Files**: `src/renderer/routes/__root.tsx`, `src/renderer/components/Sidebar.tsx`
- **Commit message**: `feat: make left sidebar resizable with drag handle`
- **Bisect note**: Self-contained — sidebar becomes resizable but width not yet persisted
- **Implementation notes**: Used `orientation="horizontal"` instead of `direction="horizontal"` as `react-resizable-panels` v4 uses `orientation` prop. Used pixel-based sizes (`defaultSize="256px"`, `minSize="180px"`, `maxSize="400px"`). Removed `w-64` and `border-r` from Sidebar component (border now handled by handle). Updated `ResizablePanelGroup` in resizable.tsx to remove stale `data-[panel-group-direction=vertical]` class from v2/v3 API. Handle styled with `cursor-col-resize`.
- **Validation results**: Lint passes (exit 0), TypeScript type check passes (exit 0, no errors).

### ✅ Phase 3: Resizable right sidebar with collapse toggle
- **Step**: 3
- **Complexity**: 3
- [x] Wrap the feature detail content and `PlanSidebar` in a `ResizablePanelGroup` in the feature route
- [x] Add `ResizableHandle` between content and PlanSidebar panels
- [x] Set constraints: 240px min, 600px max when expanded
- [x] Add a collapse/expand toggle button (chevron icon) on the PlanSidebar header or on the resize handle
- [x] When collapsed, panel collapses to 0px; re-expanding restores last width
- [x] Use `collapsible` prop on the ResizablePanel and `onCollapse`/`onExpand` callbacks
- **Files**: `src/renderer/routes/projects/$projectId/features/$featureId.tsx`, `src/renderer/components/PlanSidebar.tsx`
- **Commit message**: `feat: make right plan sidebar resizable with collapse toggle`
- **Bisect note**: Self-contained — right sidebar becomes resizable independently of persistence
- **Implementation notes**: Replaced the `flex` wrapper div with `ResizablePanelGroup orientation="horizontal"`. Main content is in an auto-sized `ResizablePanel`, right sidebar in a collapsible panel with `defaultSize="320px"`, `minSize="240px"`, `maxSize="600px"`, `collapsedSize="0px"`. Used `panelRef` + `useRef<PanelImperativeHandle>` for imperative `collapse()`/`expand()` calls. Toggle button uses `ChevronsRight`/`ChevronsLeft` from lucide-react in the PlanSidebar header. Removed fixed `w-80` from PlanSidebar. Collapse state tracked via `onResize` callback checking `panelSize.inPixels === 0`.
- **Validation results**: Lint passes (exit 0), TypeScript type check passes (exit 0, no errors).

### ⬜ Phase 4: Persist sidebar widths and collapsed state
- **Step**: 4
- **Complexity**: 2
- [ ] On left sidebar resize (`onResize` callback), debounce and save width to settings key `sidebar_left_width`
- [ ] On right sidebar resize/collapse, debounce and save width to `sidebar_right_width` and collapsed state to `sidebar_right_collapsed`
- [ ] On mount, read persisted values from settings and use as `defaultSize` / default collapsed state
- [ ] Create a small `useSidebarWidth` hook (or inline) that wraps the trpc queries/mutations with debounce
- **Files**: `src/renderer/routes/__root.tsx`, `src/renderer/routes/projects/$projectId/features/$featureId.tsx`, `src/renderer/components/PlanSidebar.tsx`
- **Commit message**: `feat: persist sidebar widths across sessions`
- **Bisect note**: Adds persistence on top of already-working resize; no breakage if settings are empty (falls back to defaults)

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Phase 4
- **Progress**: 3/4
