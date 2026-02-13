# Plan: Multi-line prompt when pressing Shift+Enter

## Context
The prompt bar lives in `src/renderer/components/AgentPromptBar.tsx`. It currently uses a single-line `<Input>` element. The `handleKeyDown` already checks `!e.shiftKey` before sending on Enter (line 43), but since `<input>` can't hold newlines, Shift+Enter does nothing. The fix is to swap `<Input>` for `<Textarea>` and add auto-resize behavior. A shadcn `Textarea` component already exists at `src/renderer/components/ui/textarea.tsx`.

## Clarifications
- **Resize behavior**: Auto-resize — textarea grows taller as lines are added, up to a max height, then scrolls.
- **Completion conditions**: Lint + typecheck must pass.

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Lint passes | `pnpm run lint` | Exit code 0 |
| Type check passes | `pnpm run typecheck` | Exit code 0, no errors |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1      | Single phase — swap Input for Textarea with auto-resize and Shift+Enter support |

> **Parallelism**: Only one phase needed.

## Phases

### ✅ Phase 1: Replace Input with auto-resizing Textarea
- **Step**: 1
- **Complexity**: 2
- [x] In `AgentPromptBar.tsx`, replace `Input` import with `Textarea` import
- [x] Replace `<Input>` element with `<Textarea>` — set `rows={1}`, remove fixed `h-8`, add `resize-none`, `overflow-hidden`, and `max-h-32` classes
- [x] Update `handleKeyDown` type from `HTMLInputElement` to `HTMLTextAreaElement`
- [x] Add auto-resize effect: after each `text` change, reset textarea height to `auto` then set to `scrollHeight` (use a ref + useEffect or onInput callback)
- [x] Ensure Enter sends (existing logic), Shift+Enter inserts newline (native textarea behavior)
- [x] Verify layout: the prompt bar should stay at the bottom and grow upward
- **Files**: `src/renderer/components/AgentPromptBar.tsx`
- **Commit message**: `feat: multi-line prompt with Shift+Enter for newlines`
- **Bisect note**: N/A — single file, self-contained change
- **Implementation notes**: Replaced `Input` with `Textarea` using a ref and `useEffect` for auto-resize. Changed container from `items-center` to `items-end` so the send button stays at the bottom as the textarea grows. Added prevention of bare Enter when message is empty to avoid inserting blank lines. Used `py-1.5` to match the original compact height.
- **Validation results**: Lint passes (0 errors). Typecheck passes (`npx tsc --noEmit` — note: `pnpm run typecheck` script does not exist, used `tsc` directly).

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: All phases complete
- **Progress**: 1/1
