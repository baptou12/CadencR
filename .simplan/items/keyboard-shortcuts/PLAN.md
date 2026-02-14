# Plan: Keyboard shortcuts for everything

## Context

ProductDevR is an Electron + React app with three main panel areas: left sidebar (projects/features), main content (feature workflow with agent sessions), and right sidebar (plan phases). Currently, the app has minimal keyboard handling — only Enter-key in forms and basic text input. No hotkey library is installed.

The UI is built with React 19, TanStack Router, shadcn/ui components, and Tailwind CSS v4. The root layout (`__root.tsx`) wraps everything in resizable panels. Agent sessions are collapsible panels inside `FeatureWorkflowView`. The `PlanSidebar` shows plan phases on the right.

Key files:
- `src/renderer/routes/__root.tsx` — Root layout with sidebar + main content
- `src/renderer/components/Sidebar.tsx` — Left sidebar wrapper
- `src/renderer/components/ProjectList.tsx` — Project navigation
- `src/renderer/components/FeatureList.tsx` — Feature list + create/delete
- `src/renderer/components/FeatureWorkflowView.tsx` — Main feature workflow
- `src/renderer/components/AgentSession.tsx` — Individual agent panel
- `src/renderer/components/AgentPromptBar.tsx` — Agent input + send/stop
- `src/renderer/components/PlanSidebar.tsx` — Right sidebar with plan phases
- `src/renderer/components/AgentQuestionDrawer.tsx` — Dynamic question form

## Clarifications

**Approach**: Direct keyboard shortcuts using `react-hotkeys-hook` library. No command palette for now.

**Focus system**: Three panel zones (left sidebar, main content, right sidebar). CMD+OPT+LEFT/RIGHT cycles focus between them. Left sidebar focused on initial page load. Focus indicated with an outline around the active panel.

**Shortcut map**:
- **Global**: CMD+",", CMD+OPT+LEFT/RIGHT, CMD+N, CMD+SHIFT+N
- **Left sidebar**: CMD+UP/DOWN navigates projects→features chain
- **Right sidebar**: CMD+UP/DOWN navigates phases, Enter opens phase detail
- **Feature block**: CMD+UP/DOWN navigates agents, Enter expands + focuses input, Escape stops focused agent, CMD+Escape stops ALL agents (with confirmation)
- **Question form**: CMD+<number> selects option, Enter validates/next

**"Select"** means showing a visual outline on the focused element.

**Initial focus**: Left sidebar focused on page load.

**Implementation**: Use `react-hotkeys-hook` library (~3KB, supports scopes).

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Lint passes | `pnpm run lint` | Exit code 0, no errors |
| TypeScript compiles | `npx tsc --noEmit` | Exit code 0, no type errors |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1      | Install react-hotkeys-hook, create FocusContext system, add visual focus indicators |
| 2    | 2, 3   | Global shortcuts and left sidebar navigation are independent (different files) |
| 3    | 4, 5   | Right sidebar and feature block navigation are independent (different components) |
| 4    | 6      | Question form shortcuts depend on understanding agent session patterns from step 3 |

> **Parallelism**: Phases within the same step can run in parallel (max 4).

## Phases

### ✅ Phase 1: Focus context system + library setup
- **Step**: 1
- **Complexity**: 3
- [x] Install `react-hotkeys-hook` via pnpm
- [x] Create `src/renderer/contexts/FocusContext.tsx` — React context tracking active panel zone (`left-sidebar` | `main-content` | `right-sidebar`), with `setFocusZone()` and `focusZone` value. Default to `left-sidebar`.
- [x] Create `src/renderer/hooks/useAppFocus.ts` — Hook wrapping the context, providing helpers like `isFocused(zone)`, `moveFocusLeft()`, `moveFocusRight()`
- [x] Wrap root layout in `FocusProvider` in `__root.tsx`
- [x] Add focus outline CSS — when a panel zone is focused, show a subtle `ring-2 ring-blue-500/50` outline on the container element. Add `data-focus-zone` attributes to the panel containers in `__root.tsx`.
- [x] Wire up click handlers on panel zones to update focus when user clicks into a panel
- **Files**: `package.json`, `pnpm-lock.yaml`, `src/renderer/contexts/FocusContext.tsx` (new), `src/renderer/hooks/useAppFocus.ts` (new), `src/renderer/routes/__root.tsx`
- **Commit message**: `feat: add focus context system with react-hotkeys-hook`
- **Bisect note**: Self-contained — adds context + visual indicators but no shortcuts yet. No broken imports since nothing consumes the hooks until later phases.
- **Implementation notes**: Installed react-hotkeys-hook v5.2.4. Created FocusContext with FocusProvider and useFocusContext hook. Created useAppFocus helper hook with isFocused, moveFocusLeft, moveFocusRight (wraps around cyclically). Split RootLayout into RootLayout (wraps FocusProvider) and RootLayoutInner (uses the context). Added data-focus-zone attributes and ring-2 ring-blue-500/50 focus outlines to left-sidebar and main-content panels. Click handlers on panel divs update focusZone. The right-sidebar zone is not yet visible in the root layout (it is rendered inside routes by PlanSidebar), so its data-focus-zone attribute will be added in Phase 4.
- **Validation results**: Lint passes (0 warnings, 0 errors). TypeScript compiles with no errors.

### ✅ Phase 2: Global keyboard shortcuts
- **Step**: 2
- **Complexity**: 3
- [x] Register CMD+"," to navigate to `/settings` via TanStack Router's `useNavigate()`
- [x] Register CMD+OPT+LEFT/RIGHT to cycle focus zones using `moveFocusLeft()`/`moveFocusRight()` from FocusContext
- [x] Register CMD+N to create a new feature on the currently selected project (reuse existing create-feature logic from FeatureList). If no project selected, do nothing.
- [x] Register CMD+SHIFT+N to create a new free session on the selected project. If no project, do nothing.
- [x] Shortcuts should be registered at the root layout level (`__root.tsx`) so they work everywhere
- [x] Prevent default browser behavior for these key combos (e.g., CMD+"," might open browser prefs)
- **Files**: `src/renderer/routes/__root.tsx`
- **Commit message**: `feat: add global keyboard shortcuts (settings, focus, new feature/session)`
- **Bisect note**: N/A — all shortcuts registered in one file, no cross-file dependencies.
- **Implementation notes**: All shortcuts registered in `RootLayoutInner` using `useHotkeys` from `react-hotkeys-hook`. Active project ID is extracted from the URL via `useRouterState()` regex match. CMD+N opens a dialog (same pattern as FeatureList) with title input; CMD+SHIFT+N creates a session immediately and navigates to it. Both CMD+, and CMD+OPT+LEFT/RIGHT have `enableOnFormTags: true` so they work even when focused in text inputs. CMD+N and CMD+SHIFT+N have `enableOnFormTags: false` to avoid conflicts when typing in form fields. All handlers call `e.preventDefault()` to suppress default browser/Electron behavior. Added `trpc.features.create` and `trpc.features.createSession` mutations with proper invalidation and navigation on success.
- **Validation results**: Lint passes (0 warnings, 0 errors). TypeScript compiles with no errors.

### ✅ Phase 3: Left sidebar navigation shortcuts
- **Step**: 2
- **Complexity**: 3
- [x] Add CMD+UP/DOWN handlers that only activate when `focusZone === 'left-sidebar'`
- [x] Track the currently selected/focused item index in the sidebar (projects + features as one flat list)
- [x] CMD+DOWN moves selection down: navigate through features in current project, then to next project, then its features
- [x] CMD+UP moves selection up: reverse direction
- [x] Show selected element with an outline/ring style
- [x] When a project or feature is selected via keyboard, navigate to it (same as clicking it)
- [x] Handle edge cases: wrap around at top/bottom, empty lists, no project selected
- **Files**: `src/renderer/components/Sidebar.tsx`, `src/renderer/components/ProjectList.tsx`, `src/renderer/components/FeatureList.tsx`
- **Commit message**: `feat: add keyboard navigation for sidebar (CMD+UP/DOWN)`
- **Bisect note**: Only activates when left sidebar is focused. No impact on other panels.
- **Implementation notes**: Fetched projects and features data at the Sidebar level (using `trpc.projects.list.useQuery()` and `trpc.features.listByProject.useQuery()`) to build a flat `NavItem[]` list of projects interleaved with features for the currently selected project. Added `keyboardFocusIndex` state tracked in Sidebar.tsx. Used `useHotkeys` for `meta+down` and `meta+up` with `enabled: focusZone === 'left-sidebar'` guard. Navigation wraps around at both ends. Selecting a project updates sidebar state; selecting a feature navigates to its route. Added `keyboardFocusProjectId` prop to ProjectList and `keyboardFocusFeatureId` prop to FeatureList, which apply `ring-2 ring-ring ring-offset-1 ring-offset-background` styling to the focused item. Used `projectsQuery.data` and `featuresQuery.data` directly in useMemo deps (rather than `?? []` derived arrays) to satisfy exhaustive-deps lint rule. No dedicated `/projects/$projectId` route exists, so project selection only updates sidebar state without navigation.
- **Validation results**: Lint passes (0 warnings, 0 errors). TypeScript compiles with no errors.

### ⬜ Phase 4: Right sidebar (plan) navigation shortcuts
- **Step**: 3
- **Complexity**: 2
- [ ] Add CMD+UP/DOWN handlers that only activate when `focusZone === 'right-sidebar'`
- [ ] Track currently focused phase index in PlanSidebar
- [ ] CMD+DOWN moves to next phase, CMD+UP to previous phase
- [ ] Show focused phase with outline/ring style
- [ ] Enter on focused phase opens the phase detail view (expand/modal)
- [ ] Handle edge cases: no plan, empty phases, wrap behavior
- **Files**: `src/renderer/components/PlanSidebar.tsx`
- **Commit message**: `feat: add keyboard navigation for plan sidebar (CMD+UP/DOWN, Enter)`
- **Bisect note**: Self-contained in PlanSidebar. Only activates when right sidebar focused.

### ⬜ Phase 5: Feature block agent navigation & control shortcuts
- **Step**: 3
- **Complexity**: 4
- [ ] Add CMD+UP/DOWN handlers that only activate when `focusZone === 'main-content'`
- [ ] Track currently focused agent index in FeatureWorkflowView
- [ ] CMD+DOWN moves focus to next agent session, CMD+UP to previous
- [ ] If agent is expanded, focus its text input (AgentPromptBar textarea)
- [ ] If agent is collapsed, focus the agent block header (show outline)
- [ ] Enter on focused collapsed agent → expand it and focus its prompt bar
- [ ] Escape → if focused agent is running, stop it (even when focus is in the text field)
- [ ] CMD+Escape → show confirmation dialog ("Stop all running agents across all features?"), if confirmed, stop all agents app-wide using `agents.stop` for each active subprocess
- [ ] Use `agents.getActiveFeatureIds` + feature subprocess tracking for stop-all
- **Files**: `src/renderer/components/FeatureWorkflowView.tsx`, `src/renderer/components/AgentSession.tsx`, `src/renderer/components/AgentPromptBar.tsx`
- **Commit message**: `feat: add agent navigation and control shortcuts (CMD+UP/DOWN, Enter, Escape)`
- **Bisect note**: Multiple files but all within feature block scope. Agent stop logic uses existing tRPC mutations.

### ⬜ Phase 6: AskUserQuestion form shortcuts
- **Step**: 4
- **Complexity**: 2
- [ ] Add CMD+1 through CMD+9 handlers in AgentQuestionDrawer to select/toggle option by index
- [ ] For multi-select questions, CMD+<number> toggles without unchecking other selections
- [ ] For single-select questions, CMD+<number> selects exclusively
- [ ] Enter key validates the current question (moves to next question, or submits form if last)
- [ ] Visual feedback when option is selected via keyboard (brief highlight animation)
- [ ] Only active when a question form is visible/mounted
- **Files**: `src/renderer/components/AgentQuestionDrawer.tsx`
- **Commit message**: `feat: add keyboard shortcuts for agent question forms (CMD+number, Enter)`
- **Bisect note**: Self-contained in AgentQuestionDrawer. No cross-component dependencies.

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Phase 4
- **Progress**: 3/6
