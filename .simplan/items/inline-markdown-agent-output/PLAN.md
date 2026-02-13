# Plan: Inline markdown from agent output

## Context
Agent text output is rendered in `src/renderer/components/AgentBlock.tsx` via a `TextBlock` component that uses `whitespace-pre-wrap` — plain text only, no markdown processing. No markdown libraries are currently installed. The app uses Tailwind CSS v4 without the typography plugin. Text content streams incrementally via SDK events and is appended to block state in `useAgentState.ts`.

## Clarifications
- **Scope**: Full GFM markdown (bold, italic, code, links, lists, headers, tables, blockquotes, HR)
- **Library**: `react-markdown` with remark-gfm plugin
- **Streaming**: Incremental rendering — re-render markdown as text streams in
- **Completion**: lint + typecheck + build must pass

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Lint passes | `pnpm run lint` | Exit code 0 |
| Type check passes | `npx tsc --noEmit` | No errors |
| Build succeeds | `pnpm run package` | Exit code 0 |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1      | Install dependencies |
| 2    | 2      | Replace TextBlock with markdown renderer and style it |

> **Parallelism**: Phases within the same step can run in parallel (max 4).

## Phases

### ⬜ Phase 1: Install react-markdown and remark-gfm
- **Step**: 1
- **Complexity**: 1
- [ ] Run `pnpm add react-markdown remark-gfm`
- **Files**: `package.json`, `pnpm-lock.yaml`
- **Commit message**: `feat: add react-markdown and remark-gfm dependencies`
- **Bisect note**: N/A — no code changes, just dependency addition

### ⬜ Phase 2: Create reusable Markdown component and use it in TextBlock
- **Step**: 2
- **Complexity**: 3
- [ ] Create `src/renderer/components/Markdown.tsx` — a reusable `<Markdown>` component wrapping `ReactMarkdown` with `remarkGfm`
- [ ] Configure `components` prop overrides for: headings (sized appropriately), inline `code`, fenced code blocks (match existing CodeBlock styling), links (target="_blank" + rel="noopener noreferrer"), tables, blockquotes, lists
- [ ] Add Tailwind styling via a wrapper div with appropriate spacing/typography classes
- [ ] Accept `className` prop for flexibility in different contexts
- [ ] Import and use `<Markdown>` in `AgentBlock.tsx` `TextBlock`, replacing the plain text div
- **Files**: `src/renderer/components/Markdown.tsx`, `src/renderer/components/AgentBlock.tsx`
- **Commit message**: `feat: add reusable Markdown component and render markdown in agent text output`
- **Bisect note**: Both files must be in same commit since AgentBlock imports the new component

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Not started
- **Progress**: 0/2
