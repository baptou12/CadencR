# Plan: Diff Viewer

## Context
ProductDevR is an Electron app with tRPC IPC, SQLite DB, TanStack Router, and Tailwind/shadcn UI. Git operations exist in `src/main/git/worktree.ts` (stats, worktree management). The `gitRouter` in `router.ts` exposes endpoints consumed by the renderer via `@trpc/react-query`. Features have worktree paths stored in `feature_settings`. The feature page (`$featureId.tsx`) has a `FeatureTopBar` with git stats.

## Clarifications
- **Diff library**: `@git-diff-view/react` — GitHub-style UI with widget system for inline comments
- **Diff modes**: Modular — supports both worktree diff (uncommitted changes) and branch comparison (current branch vs target/main)
- **UI placement**: Modal dialog centered on screen, opened from a button in FeatureTopBar
- **Comments**: Per-line comments via hover button on each line. Stored in SQLite AND can be sent to the AI agent as modification instructions
- **Code view**: Monaco for code editing, `@git-diff-view/react` for diff display
- **Theme**: Dracula theme — override `@git-diff-view/react` CSS variables: bg `#282a36`, current line `#44475a`, additions bg `#2e4033` / text `#50fa7b`, deletions bg `#4d2228` / text `#ff5555`, line numbers `#6272a4`, text `#f8f8f2`, purple accents `#bd93f9`, selection `#44475a`

### UI Layout (3-panel)

**Left panel — File tree sidebar:**
- Searchable file filter input at top
- Tree view of changed files organized by directory (collapsible folders)
- Each file shows an icon indicating change type (added/modified/deleted/renamed)
- Each file entry has an expand/collapse `[+]` button to toggle its diff in the center panel
- Clicking a file scrolls the center panel to that file's diff

**Center panel — Diff area:**
- Header bar showing "N files changed" with total addition/deletion counters (e.g. `+120 -45`)
- Virtual scroll support for large diffs
- Per-file sections, each with:
  - Collapsible header showing file path with expand/collapse chevron
  - Hunk headers (`@@ -3,7 +3,7 @@`) styled as distinct bars
  - Line numbers on both sides (old/new) in split mode
  - `+` / `-` gutter markers for added/removed lines with colored backgrounds
  - Syntax highlighting via lowlight (default) or shiki engine
  - Unchanged context lines shown between hunks

**Right panel — Settings popover (gear icon top-right):**
- **Font Size**: Small / Medium (default) / Large — radio group
- **Diff Mode**: Split (default) / Unified — radio group
- **Line Mode**: Wrap (default) / No Wrap — radio group
- **Highlight Mode**: Enable (default) / Disable — radio group
- **Highlight Engine**: lowlight (default) / shiki — radio group (note: changing requires reload)
- **AutoLoad FullDiff**: Enable / Disable (default) — radio group

**Top bar — Search in diff:**
- Text search input ("Search in the diff") at top-right of center panel
- Highlights matching text across all file diffs

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Lint passes | `pnpm run lint` | Exit code 0, no errors |
| TypeScript | `npx tsc --noEmit` | No type errors |
| Build succeeds | `pnpm run package` | Exit code 0, package completes |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1, 2   | Install deps + DB migration (independent) |
| 2    | 3, 4   | Backend git diff endpoints + comment tRPC routes (independent sub-routers) |
| 3    | 5      | Core DiffViewer component with @git-diff-view/react + Dracula theme |
| 4    | 6, 7   | File tree sidebar + diff header/counters (independent UI panels) |
| 5    | 8      | Settings popover (gear icon) |
| 6    | 9      | Search in diff |
| 7    | 10     | Per-line comment widget |
| 8    | 11     | Modal dialog + FeatureTopBar button + send-to-agent action |

> **Parallelism**: Phases within the same step can run in parallel (max 4).

## Phases

### ✅ Phase 1: Install @git-diff-view/react and lowlight dependencies
- **Step**: 1
- **Complexity**: 1
- [x] Run `pnpm add @git-diff-view/react @git-diff-view/lowlight lowlight`
- [x] Verify packages install and types are available
- **Files**: `package.json`, `pnpm-lock.yaml`
- **Commit message**: `chore: add @git-diff-view/react and lowlight dependencies`
- **Bisect note**: N/A
- **Implementation notes**: Installed `@git-diff-view/react@^0.0.39`, `@git-diff-view/lowlight@^0.0.39`, `lowlight@^3.3.0`. +45 packages added.
- **Validation results**: Lint passes (0 errors), TypeScript `tsc --noEmit` passes (no type errors).

### ✅ Phase 2: Add diff_comments DB migration
- **Step**: 1
- **Complexity**: 2
- [x] Add migration 10: Create `diff_comments` table with columns: `id`, `feature_id`, `file_path`, `line_number`, `side` (old/new), `content`, `status` (pending/sent/resolved), `created_at`
- [x] Table supports per-line comments linked to features
- **Files**: `src/main/db/migrations.ts`
- **Commit message**: `feat: add diff_comments table migration`
- **Bisect note**: N/A — migration is additive, no existing code references this table
- **Implementation notes**: Added migration version 10 with CHECK constraints on `side` ('old'/'new') and `status` ('pending'/'sent'/'resolved'). Foreign key references `features(id)`.
- **Validation results**: Lint passed (0 errors), TypeScript type check passed (no errors).

### ✅ Phase 3: Add git diff tRPC endpoints
- **Step**: 2
- **Complexity**: 3
- [x] Add `getDiff` function to `src/main/git/worktree.ts` — runs `git diff` (worktree mode) or `git diff main...HEAD` (branch mode), returns raw unified diff string
- [x] Add `getChangedFiles` function — runs `git diff --name-status`, returns list of `{ file, status, oldFile? }` with per-file addition/deletion line counts (via `git diff --numstat`)
- [x] Add `git.getDiff` and `git.getChangedFiles` procedures to `gitRouter` in `router.ts`
- [x] Input: `{ featureId, mode: "worktree" | "branch", targetBranch?: string }`
- **Files**: `src/main/git/worktree.ts`, `src/main/trpc/router.ts`
- **Commit message**: `feat: add git diff and changed files tRPC endpoints`
- **Bisect note**: N/A — new endpoints, not called yet
- **Implementation notes**: Added `getDiff` and `getChangedFiles` functions to `worktree.ts` with `ChangedFile` interface. Both functions handle worktree/branch modes, with 50MB maxBuffer for large diffs. Added corresponding `git.getDiff` and `git.getChangedFiles` query procedures to `gitRouter` that resolve worktree path from `feature_settings`. Handles renames/copies in `--name-status` output.
- **Validation results**: Lint passed (0 errors), TypeScript `tsc --noEmit` passed (no type errors).

### ✅ Phase 4: Add diff comments tRPC sub-router
- **Step**: 2
- **Complexity**: 3
- [x] Create `src/main/trpc/diff-comments.ts` with CRUD procedures: `create`, `list` (by feature_id), `update` (content/status), `delete`
- [x] Add `markAsSent` mutation to batch-update comment statuses to "sent"
- [x] Register sub-router in `appRouter` as `diffComments`
- **Files**: `src/main/trpc/diff-comments.ts`, `src/main/trpc/router.ts`
- **Commit message**: `feat: add diff comments tRPC sub-router`
- **Bisect note**: N/A — new sub-router, not consumed yet
- **Implementation notes**: Created `diffCommentsRouter` with 5 procedures: `create` (inserts with status 'pending'), `list` (by feature_id, ordered by file_path and line_number), `update` (dynamic SET for content/status), `delete`, and `markAsSent` (batch updates pending to sent). Registered as `diffComments` in appRouter. Used `DiffCommentRow` interface for type safety on query results.
- **Validation results**: Lint passed (0 errors), TypeScript `tsc --noEmit` passed (no type errors).

### ✅ Phase 5: Core DiffViewer component with Dracula theme
- **Step**: 3
- **Complexity**: 4
- [x] Create `src/renderer/components/diff/DiffViewer.tsx` — main container component, 3-panel layout (sidebar | diff area | settings)
- [x] Import `@git-diff-view/react` `DiffView` component and `@git-diff-view/react/styles/diff-view.css`
- [x] Configure `DiffView` with lowlight syntax highlighting engine by default
- [x] Wire up `git.getDiff` query, parse unified diff into per-file diff data for `DiffView`
- [x] Render per-file collapsible sections: chevron toggle in file header, hunk headers (`@@ ... @@`) as distinct styled bars
- [x] Line numbers on both sides in split mode, `+`/`-` gutter markers
- [x] Virtual scroll for large diffs
- [x] Create `src/renderer/components/diff/dracula-diff.css` — override all `@git-diff-view/react` CSS variables: bg `#282a36`, current line `#44475a`, added line bg `#2e4033`, added text `#50fa7b`, removed line bg `#4d2228`, removed text `#ff5555`, line numbers `#6272a4`, text `#f8f8f2`, hunk header bg `#343746`, selection `#44475a`, border `#6272a4`
- **Files**: `src/renderer/components/diff/DiffViewer.tsx`, `src/renderer/components/diff/dracula-diff.css`
- **Commit message**: `feat: create core DiffViewer component with Dracula theme`
- **Bisect note**: Component exists but is not mounted anywhere yet
- **Implementation notes**: Created `DiffViewer.tsx` with `DiffViewerProps` interface (featureId, mode, targetBranch). Parses raw unified diff into per-file sections using `parseUnifiedDiff()`, creates `DiffFile` instances via `DiffFile.createInstance()` with lowlight highlighter. Each file rendered as collapsible section with chevron toggle, per-file +/- counters. Header bar shows total files changed with aggregate addition/deletion counts. Split/Unified mode toggle in header. Uses `@git-diff-view/lowlight` highlighter registered on each DiffFile. `dracula-diff.css` overrides all CSS variables via `.dracula-diff` wrapper class. Language detection via file extension mapping in `langFromPath()`.
- **Validation results**: Lint passed (0 errors), TypeScript `tsc --noEmit` passed (no type errors), `pnpm run package` succeeded.

### ✅ Phase 6: File tree sidebar
- **Step**: 4
- **Complexity**: 3
- [x] Create `src/renderer/components/diff/DiffFileTree.tsx`
- [x] Render changed files as a collapsible directory tree (group files by folder path, folders are collapsible)
- [x] Each file entry shows: file icon indicating change type (added=green, modified=yellow, deleted=red, renamed=blue), file name
- [x] Each file entry has a `[+]`/`[-]` button to expand/collapse that file's diff in the center panel
- [x] Clicking a file name scrolls the center diff panel to that file's section
- [x] File filter search input at the top of the sidebar — filters the tree as you type
- [x] Show active/selected file highlight
- **Files**: `src/renderer/components/diff/DiffFileTree.tsx`
- **Commit message**: `feat: add file tree sidebar to diff viewer`
- **Bisect note**: Integrated into DiffViewer layout from Phase 5
- **Implementation notes**: Created `DiffFileTree` component with `ChangedFileEntry` interface matching backend `ChangedFile` shape. Files grouped into directory tree via `buildTree()`, sorted directories-first then alphabetically. Each file shows colored status letter (A=green, M=yellow, D=red, R=blue) and +/- button to toggle diff expansion. Filter input uses recursive `matchesFilter()`. Component accepts `onToggleExpand` and `onSelectFile` callbacks for parent control. Directories independently collapsible via local state.
- **Validation results**: Lint passed (0 errors, 1 warning about nested function), TypeScript `tsc --noEmit` passed (no type errors).

### ✅ Phase 7: Diff header bar with file count and change counters
- **Step**: 4
- **Complexity**: 2
- [x] Create `src/renderer/components/diff/DiffHeader.tsx`
- [x] Show "N files changed" label with file count icon
- [x] Show total addition counter (green `+N`) and deletion counter (red `-N`) aggregated from all files
- [x] Per-file headers also show individual `+N -N` counters
- **Files**: `src/renderer/components/diff/DiffHeader.tsx`
- **Commit message**: `feat: add diff header with file count and change counters`
- **Bisect note**: Integrated into DiffViewer layout
- **Implementation notes**: Created `DiffHeader` component with `FileText` icon from lucide-react, file count label, and green/red aggregate counters. Also created `FileHeader` component for per-file headers with chevron toggle (SVG with rotate transition), file name, and individual +/- counters. Both components accept props and render with Dracula theme colors. A `children` slot in `DiffHeader` allows other phases to inject controls (e.g., split/unified toggle, settings). Components are not yet wired into `DiffViewer.tsx` to avoid conflicting with parallel Phase 6.
- **Validation results**: Lint passed (0 errors), TypeScript `tsc --noEmit` passed (no type errors).

### ⬜ Phase 8: Settings popover
- **Step**: 5
- **Complexity**: 2
- [ ] Create `src/renderer/components/diff/DiffSettings.tsx` — popover triggered by gear icon button in top-right
- [ ] **Font Size**: Small / Medium (default) / Large — radio group, applies CSS font-size to diff area
- [ ] **Diff Mode**: Split (default) / Unified — radio group, switches `DiffView` mode prop
- [ ] **Line Mode**: Wrap (default) / No Wrap — radio group, toggles CSS `white-space` on diff lines
- [ ] **Highlight Mode**: Enable (default) / Disable — radio group, toggles syntax highlighting
- [ ] **Highlight Engine**: lowlight (default) / shiki — radio group (note in UI: "reload required" to switch)
- [ ] **AutoLoad FullDiff**: Enable / Disable (default) — radio group, controls whether full file diff loads automatically or on-demand
- [ ] Persist settings in React state (per-session, no DB needed)
- **Files**: `src/renderer/components/diff/DiffSettings.tsx`
- **Commit message**: `feat: add settings popover to diff viewer`
- **Bisect note**: Reads/writes state already managed in DiffViewer

### ⬜ Phase 9: Search in diff
- **Step**: 6
- **Complexity**: 3
- [ ] Create `src/renderer/components/diff/DiffSearch.tsx` — search input in the top-right of the diff area ("Search in the diff" placeholder)
- [ ] On typing, highlight all matching text occurrences across all file diffs (use DOM-based text highlighting or `@git-diff-view/react` highlight API if available)
- [ ] Show match count (e.g., "3/15")
- [ ] Up/down arrows or Enter/Shift+Enter to navigate between matches, scrolling to each
- [ ] Clear button to reset search
- **Files**: `src/renderer/components/diff/DiffSearch.tsx`
- **Commit message**: `feat: add search-in-diff functionality`
- **Bisect note**: Operates on rendered diff DOM; no backend changes

### ⬜ Phase 10: Per-line comment widget
- **Step**: 7
- **Complexity**: 4
- [ ] Use `@git-diff-view/react` widget system (`renderWidgetLine`) to render inline comment forms
- [ ] Add hover button on each diff line that opens a comment textarea
- [ ] Wire comment creation to `diffComments.create` mutation
- [ ] Display existing comments inline using the widget system
- [ ] Add comment delete/edit actions
- **Files**: `src/renderer/components/diff/DiffViewer.tsx`, `src/renderer/components/diff/DiffCommentWidget.tsx`
- **Commit message**: `feat: add per-line commenting to diff viewer`
- **Bisect note**: Builds on Phase 5's component

### ⬜ Phase 11: Modal dialog, TopBar button, and send-to-agent action
- **Step**: 8
- **Complexity**: 3
- [ ] Create `src/renderer/components/diff/DiffViewerModal.tsx` wrapping DiffViewer in a near-full-screen shadcn dialog
- [ ] Add "View Diff" button to `FeatureTopBar.tsx` (next to terminal button)
- [ ] Add "Send comments to agent" button in modal footer — collects pending comments, calls `diffComments.markAsSent`, and triggers agent with comment instructions
- [ ] Wire agent trigger to existing agent session infrastructure
- **Files**: `src/renderer/components/diff/DiffViewerModal.tsx`, `src/renderer/components/FeatureTopBar.tsx`
- **Commit message**: `feat: add diff viewer modal with send-to-agent action`
- **Bisect note**: This phase completes the feature; FeatureTopBar gets a new button

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Phase 8
- **Progress**: 7/11
