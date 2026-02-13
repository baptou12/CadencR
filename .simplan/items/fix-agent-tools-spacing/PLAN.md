# Plan: Fix agent execution tools spacing

## Context
The agent stream renders blocks via `AgentBlock.tsx` and `AgentStream.tsx`. When tool call details (file paths, args summaries) are very long, text overflows the container and breaks the layout. The fix is to ensure all text in tool/compact blocks is properly truncated with ellipsis and contained within their parent boundaries using `overflow-hidden`, `truncate`, and `min-w-0` where needed.

Key files:
- `src/renderer/components/AgentBlock.tsx` — All block components (ToolCallBlock, CompactBlock, TaskAgentBlock, etc.)
- `src/renderer/components/AgentStream.tsx` — Outer scroll container

## Clarifications
- All tool block types need fixing, not just one specific type
- Long text in the events list breaks layout — needs ellipsis truncation
- Completion: lint + typecheck must pass

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Lint passes | `pnpm run lint` | Exit code 0 |
| Type check passes | `pnpm run typecheck` | Exit code 0 |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1      | Fix all overflow/truncation issues in AgentBlock.tsx |

> **Parallelism**: Single phase, no parallelism needed.

## Phases

### ⬜ Phase 1: Fix text overflow in all agent block types
- **Step**: 1
- **Complexity**: 2
- [ ] Add `overflow-hidden` to the outer container in `AgentStream.tsx` (`space-y-1 p-3` div)
- [ ] In `ToolCallBlock`: add `min-w-0` to the button flex container so `truncate` on the detail span works; ensure the whole row doesn't push past its parent
- [ ] In `CompactBlock`: add `min-w-0` to the outer flex div and ensure detail text truncates
- [ ] In `TaskAgentBlock` header: add `min-w-0` to the button flex container so the description truncates properly
- [ ] In `ThinkingBlock` / `TextBlock` area: ensure long unbroken text wraps or truncates within bounds
- **Files**: `src/renderer/components/AgentBlock.tsx`, `src/renderer/components/AgentStream.tsx`
- **Commit message**: `fix: prevent agent tool blocks from overflowing parent container`
- **Bisect note**: N/A

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Not started
- **Progress**: 0/1
