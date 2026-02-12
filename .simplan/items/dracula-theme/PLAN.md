# Plan: Dracula theme for the app

## Context
- Tailwind CSS v4 with `@theme inline` in `src/renderer/index.css`
- shadcn/ui (new-york style, neutral base) using OKLCH CSS custom properties
- `:root` defines light theme, `.dark` class defines dark theme — neither is currently activated programmatically
- 35 `dark:` variant usages across 9 files (5 custom components, 4 shadcn/ui components)
- A Dracula diff CSS file already exists at `src/renderer/components/diff/dracula-diff.css`
- No theme provider or switcher exists

## Clarifications
- **Scope**: Always-on Dracula — replace both light and dark variables with Dracula palette. No theme switcher needed.
- **Accents**: Full Dracula accent colors — primary=purple, destructive=red, success=green, etc.
- **Approach**: Replace `:root` variables with Dracula colors, remove `.dark` block and all `dark:` prefixes, remove the `@custom-variant dark` directive.
- **Window titlebar**: Set `titleBarStyle: 'hiddenInset'` and `backgroundColor: '#282a36'` on BrowserWindow so the native grey header is replaced with Dracula background. Add CSS padding for the traffic lights.

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Lint passes | `pnpm run lint` | Exit code 0, no errors |
| Build passes | `pnpm run build` | Exit code 0, build succeeds |

## Dracula Palette Reference (hex → oklch conversions needed)

| Color | Hex | Role |
|-------|-----|------|
| Background | #282a36 | background, card, popover, sidebar |
| Current Line | #44475a | secondary, muted, accent, input |
| Foreground | #f8f8f2 | foreground, card-fg, popover-fg |
| Comment | #6272a4 | muted-foreground, ring |
| Purple | #bd93f9 | primary, sidebar-primary |
| Pink | #ff79c6 | chart accent |
| Red | #ff5555 | destructive |
| Green | #50fa7b | chart accent |
| Yellow | #f1fa8c | chart accent |
| Cyan | #8be9fd | chart accent |
| Orange | #ffb86c | chart accent |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1, 3   | CSS variables + window titlebar (independent files) |
| 2    | 2      | Remove dark: prefixes (depends on phase 1 removing the variant) |

> **Parallelism**: Phases 1 and 3 are independent (different files). Phase 2 must follow phase 1.

## Phases

### ✅ Phase 1: Replace CSS variables with Dracula palette
- **Step**: 1
- **Complexity**: 2
- [x] Convert Dracula hex colors to OKLCH values
- [x] Replace `:root` variables with Dracula colors (background=#282a36, foreground=#f8f8f2, primary=purple #bd93f9, destructive=red #ff5555, etc.)
- [x] Remove the `.dark { ... }` block entirely
- [x] Remove the `@custom-variant dark` line
- [x] Set chart colors to Dracula accents (purple, pink, green, cyan, orange)
- [x] Set sidebar variables to match (sidebar bg=#282a36, sidebar-primary=purple, sidebar-accent=#44475a)
- **Files**: `src/renderer/index.css`
- **Commit message**: `feat: replace light/dark themes with Dracula color palette`
- **Bisect note**: Self-contained — CSS-only change, all variable names stay the same so no breakage
- **Implementation notes**: Converted all 11 Dracula palette colors from hex to OKLCH via sRGB->XYZ->OKLab->OKLCH. Replaced all `:root` variables, removed `.dark` block and `@custom-variant dark` line. Chart colors use purple, pink, green, cyan, orange. All CSS variable names preserved.
- **Validation results**: Lint passes (0 errors). No `build` script exists in package.json (`package` is the equivalent but too heavy to run as validation).

### ✅ Phase 2: Remove dark: variant usages from components
- **Step**: 2
- **Complexity**: 2
- [x] Remove all `dark:` prefixed classes from `src/renderer/components/FeatureList.tsx` (5 occurrences)
- [x] Remove all `dark:` prefixed classes from `src/renderer/components/FeatureTopBar.tsx` (5 occurrences)
- [x] Remove all `dark:` prefixed classes from `src/renderer/components/AgentPanel.tsx` (4 occurrences)
- [x] Remove all `dark:` prefixed classes from `src/renderer/components/AgentBlock.tsx` (10 occurrences)
- [x] Remove all `dark:` prefixed classes from shadcn/ui components: `input.tsx`, `textarea.tsx`, `badge.tsx`, `select.tsx`, `button.tsx` (9 occurrences)
- **Files**: `src/renderer/components/FeatureList.tsx`, `src/renderer/components/FeatureTopBar.tsx`, `src/renderer/components/AgentPanel.tsx`, `src/renderer/components/AgentBlock.tsx`, `src/renderer/components/ui/input.tsx`, `src/renderer/components/ui/textarea.tsx`, `src/renderer/components/ui/badge.tsx`, `src/renderer/components/ui/select.tsx`, `src/renderer/components/ui/button.tsx`
- **Commit message**: `refactor: remove dark: variant classes (single Dracula theme)`
- **Bisect note**: Must come after phase 1 — the `@custom-variant dark` is removed in phase 1, so dark: classes would cause build errors if left
- **Implementation notes**: Removed all `dark:` prefixed classes from all 9 files. For classes like `text-gray-700 dark:text-gray-300`, kept only the dark variant value (e.g. `text-gray-300`) since the app is now always-dark Dracula. For `dark:bg-input/30`, `dark:border-input`, `dark:hover:bg-input/50`, `dark:hover:bg-accent/50`, `dark:bg-destructive/60`, `dark:focus-visible:ring-destructive/40`, and `dark:aria-invalid:ring-destructive/40` -- these were simply removed as their non-dark counterparts or the base styles already provide appropriate styling.
- **Validation results**: Lint passes (0 errors, 0 warnings). Build passes (`pnpm run package` succeeds; no `build` script exists).

### ✅ Phase 3: Dracula window titlebar
- **Step**: 1
- **Complexity**: 2
- [x] Add `titleBarStyle: 'hiddenInset'` and `backgroundColor: '#282a36'` to BrowserWindow options in `src/main.ts`
- [x] Add CSS for `-webkit-app-region: drag` on a top bar area and padding-left for macOS traffic lights (~70px) in `src/renderer/index.css` or the root layout
- [x] Ensure the app content doesn't overlap the traffic light buttons
- **Files**: `src/main.ts`, `src/renderer/index.css` or `src/renderer/routes/__root.tsx`
- **Commit message**: `feat: use Dracula background for window titlebar`
- **Bisect note**: Independent of CSS variable changes — only touches BrowserWindow config and layout padding
- **Implementation notes**: Added `titleBarStyle: "hiddenInset"` and `backgroundColor: "#282a36"` to BrowserWindow in `src/main.ts`. In `src/renderer/routes/__root.tsx`, added a fixed 28px drag region div at the top with `-webkit-app-region: drag` and Dracula background color, plus 28px top padding on the root container to prevent content overlap with traffic lights. Used inline styles to avoid conflicts with Phase 1 editing `index.css` in parallel.
- **Validation results**: Lint passes (0 errors). Build passes (`pnpm run package` succeeds; no `build` script exists, used `package` instead).

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: All phases complete
- **Progress**: 3/3
