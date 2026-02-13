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

### ✅ Phase 1: Install react-markdown and remark-gfm
- **Step**: 1
- **Complexity**: 1
- [x] Run `pnpm add react-markdown remark-gfm`
- **Files**: `package.json`, `pnpm-lock.yaml`
- **Commit message**: `feat: add react-markdown and remark-gfm dependencies`
- **Bisect note**: N/A — no code changes, just dependency addition
- **Implementation notes**: Installed react-markdown@10.1.0 and remark-gfm@4.0.1. Added 125 packages.
- **Validation results**: Lint passes (exit 0). Skipped tsc and package build as no code changes were made — only dependencies added.

### ✅ Phase 2: Create reusable Markdown component and use it in TextBlock
- **Step**: 2
- **Complexity**: 3
- [x] Create `src/renderer/components/Markdown.tsx` — a reusable `<Markdown>` component wrapping `ReactMarkdown` with `remarkGfm`
- [x] Configure `components` prop overrides for: headings (sized appropriately), inline `code`, fenced code blocks (match existing CodeBlock styling), links (target="_blank" + rel="noopener noreferrer"), tables, blockquotes, lists
- [x] Add Tailwind styling via a wrapper div with appropriate spacing/typography classes
- [x] Accept `className` prop for flexibility in different contexts
- [x] Import and use `<Markdown>` in `AgentBlock.tsx` `TextBlock`, replacing the plain text div
- **Files**: `src/renderer/components/Markdown.tsx`, `src/renderer/components/AgentBlock.tsx`
- **Commit message**: `feat: add reusable Markdown component and render markdown in agent text output`
- **Bisect note**: Both files must be in same commit since AgentBlock imports the new component
- **Implementation notes**: Created Markdown.tsx with ReactMarkdown + remarkGfm. Component overrides cover h1-h6, inline/fenced code (fenced code matches existing CodeBlock styling with language header and CodeIcon), links with target="_blank", tables, blockquotes, ul/ol lists, hr, and paragraphs. The `pre` override renders children directly so fenced code blocks are handled entirely by the `code` override. TextBlock in AgentBlock.tsx now renders `<Markdown content={content} />` instead of plain text.
- **Validation results**: Lint passes (exit 0), type check passes (no errors), package build succeeds (exit 0).

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: All phases complete
- **Progress**: 2/2
