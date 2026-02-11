---
description: Brainstorm an item with extensive Q&A (10-40 questions) before planning
argument-hint: [slug]
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
  - AskUserQuestion
  - WebFetch
  - WebSearch
  - mcp__context7__resolve-library-id
  - mcp__context7__query-docs
---

## Context

Read the `.simplan/items/` directory to see existing items. Each subdirectory is an item slug containing an `ITEM.md` file (metadata) and optionally a `PLAN.md` file (the plan).

## Configuration

Check `.simplan/config` for settings (key=value format). Relevant setting:
- `commit_plan=true` - If set, commit `.simplan/` changes after modifications

## Status Emojis

When displaying or updating item statuses, use these emojis:
- 📋 `BACKLOG` - Not yet planned
- 📝 `PLANNED` - Has a plan, ready to execute
- ⏸️ `IDLE` - Started but paused
- 🔄 `IN_PROGRESS` - Currently being worked on
- ✅ `DONE` - Completed

## Task

Conduct an extensive brainstorming session for item `$ARGUMENTS` through deep exploration and 10-40 questions, then create a comprehensive plan.

**This command is for items that need thorough analysis** - complex features, architectural decisions, or items where requirements are unclear.

## Process

### Step 1: Parse & Validate

1. Get slug from `$ARGUMENTS`
2. If no slug provided:
   - Read `.simplan/items/` and list items that are NOT `DONE` (read each `ITEM.md`)
   - Use **AskUserQuestion** to ask which one to brainstorm (use slugs as option labels, put titles in descriptions)
3. Read `.simplan/items/<slug>/ITEM.md` to extract item details: title, description
4. Confirm the item is not already `DONE` (refuse if it is)

### Step 1b: Check for Existing Plan

If `.simplan/items/<slug>/PLAN.md` exists:

1. **Read the existing plan**
2. **Extract previous context**:
   - Any existing "Context" section
   - Any existing "Clarifications" or "Q&A Log" section
   - Current phases and their status (some may be completed)
   - Any "Deferred Items" noted
3. **Inform the user**: "This item already has a plan. I'll review it and build upon the existing context during brainstorming."
4. **Preserve completed work**: If phases have checkmarks `[x]`, note which are done - these won't be re-planned unless the user wants to revise them.

This existing context will:
- Be incorporated into your initial understanding (Step 2)
- Inform which questions to skip (already answered)
- Be merged into the final updated plan (Step 6)

### Step 2: Initial Deep Exploration

Before asking any questions, thoroughly explore both the codebase AND the web:

#### 2a. Codebase Exploration

1. **Understand the landscape**:
   - Directory structure and organization
   - Key architectural patterns
   - Related features/modules
   - Testing patterns

2. **Find relevant code**:
   - Existing implementations related to the item
   - Similar features that might serve as templates
   - Integration points and dependencies
   - Configuration and environment considerations

#### 2b. Web Research (Do this proactively!)

**Actively search the web** to understand what we're building:

1. **Library/API documentation**:
   - Use **Context7** (`mcp__context7__resolve-library-id` → `mcp__context7__query-docs`) for library docs
   - Use **WebFetch** to read specific documentation pages
   - Use **WebSearch** to find tutorials, guides, and best practices

2. **Research topics to cover**:
   - How similar features are typically implemented
   - Best practices and common patterns
   - Known pitfalls and gotchas
   - Performance considerations
   - Security best practices for this type of feature

3. **Examples of when to search**:
   - Building auth? Search for "OAuth 2.0 best practices", "JWT security considerations"
   - Adding a new UI component? Search for accessibility guidelines, UX patterns
   - Integrating an API? Fetch and read the API documentation
   - Using a library? Query Context7 for up-to-date usage examples

**Don't be shy about web research** - the more context you gather, the better your questions will be.

**Summarize findings** (both codebase and web research) in a brief internal note before proceeding.

### Step 3: Extensive Question Rounds (10-40 questions total)

This is the core of brainstorm. You will ask **at least 10 questions** and **up to 40 questions** across multiple rounds. The goal is to deeply understand the item from every angle.

#### Question Categories

Cycle through these categories, asking 1-4 questions per round:

1. **Requirements & Goals**
   - What problem does this solve?
   - Who benefits from this feature?
   - What does success look like?
   - What are the acceptance criteria?

2. **User Experience**
   - How will users interact with this?
   - What's the ideal workflow?
   - What feedback should users receive?
   - Are there accessibility considerations?

3. **Technical Approach**
   - What architecture patterns should we follow?
   - Should we build on existing code or start fresh?
   - What libraries/tools are preferred?
   - Are there performance requirements?

4. **Edge Cases & Error Handling**
   - What happens when things go wrong?
   - What are the boundary conditions?
   - How do we handle invalid input?
   - What are the failure modes?

5. **Integration & Dependencies**
   - What other systems does this touch?
   - Are there API contracts to consider?
   - What about backwards compatibility?
   - Are there migration concerns?

6. **Testing & Quality**
   - What types of tests are needed?
   - Are there specific scenarios to test?
   - What about manual testing needs?
   - Performance/load testing considerations?

7. **Scope & Priorities**
   - What's in scope vs out of scope?
   - What's the MVP vs nice-to-have?
   - Are there phases to this work?
   - What can be deferred to later items?

8. **Security & Compliance**
   - Are there security implications?
   - Data privacy considerations?
   - Audit/logging requirements?
   - Compliance constraints?

9. **Operations & Maintenance**
   - How will this be monitored?
   - What logging is needed?
   - Are there deployment considerations?
   - Documentation requirements?

10. **Risks & Unknowns**
     - What are the biggest risks?
     - What don't we know yet?
     - What assumptions are we making?
     - What could go wrong?

11. **Completion Conditions** (ask once during the session)
     - What commands can the model run to validate its own work?
     - What does success look like for each validation?
     - Are there specific tests, builds, or checks that must pass?

#### Completion Conditions Question

During one of your question rounds (ideally around questions 15-25), ask about **completion conditions**:

> "Would you like to define **completion conditions** for this item? These are verifiable criteria the model will check to ensure the work is done correctly.
>
> **Two parts to define:**
>
> 1. **Validation commands** - Shell commands the model runs to test its own work:
>    - `npm test` or `pytest` (run test suite)
>    - `npm run typecheck` or `tsc --noEmit` (type checking)
>    - `npm run lint` or `eslint .` (linting)
>    - `npm run build` (build succeeds)
>    - `curl localhost:3000/api/health` (API responds)
>    - Custom scripts like `./scripts/validate.sh`
>
> 2. **Expected outcomes** - What success looks like:
>    - "All tests pass (exit code 0)"
>    - "No TypeScript errors"
>    - "Build completes without warnings"
>    - "API returns 200 with `{status: 'ok'}`"
>    - "Output contains 'Success'"
>
> Setting completion conditions allows the model to **iterate automatically** until all criteria pass, which **increases output quality**. This is optional but highly recommended for items where success is clearly measurable."

If the user provides completion conditions:
- Record them in the plan under a dedicated "Completion Conditions" section with a table format
- Include both the **validation command** and **expected outcome** for each
- The executor will run these after implementation and iterate until they pass
- The reviewer will verify all conditions before approval

If the user declines or has none, note "None specified" and proceed.

#### Question Round Protocol

For each round:

1. **Explore** (if needed) - Do targeted exploration based on previous answers
   - This includes **web research**! If the user mentions a library, API, or pattern you're not familiar with, search for it immediately
   - Use Context7 for library docs, WebSearch for general info, WebFetch for specific URLs
2. **Ask 1-4 questions** using **AskUserQuestion**
   - Mix categories to keep the conversation dynamic
   - Build on previous answers
   - Go deeper where you sense uncertainty or complexity
   - Skip categories that are clearly not relevant
   - **Incorporate web findings** into your questions (e.g., "I found that library X recommends approach Y - does that align with your thinking?")
   - **Formatting rules**: Option labels max 30 chars (use short identifiers); headers max 30 chars; put longer text in option `description` field
3. **Track progress** - Keep a mental count of questions asked
4. **Evaluate** - After each round, decide:
   - Minimum 10 questions reached? If not, continue.
   - Still have important unknowns? Continue if under 40.
   - User seems ready to move on? Consider wrapping up (if min reached).
   - Reached 40 questions? Must proceed to planning.

#### Pacing Guidelines

- **Questions 1-10**: Cover the fundamentals - requirements, user experience, basic technical approach
- **Questions 11-20**: Go deeper - edge cases, integration, testing strategy
- **Questions 21-30**: Polish - security, operations, risks
- **Questions 31-40**: Final refinements - only if there's genuine uncertainty remaining

**Important**: Don't ask questions just to hit a number. If you've covered everything thoroughly by question 15, you can proceed. But don't rush - complex items often reveal surprises in the later questions.

### Step 4: Synthesize & Validate Understanding

After the question rounds, summarize your understanding:

1. **Write a summary** (don't save yet) covering:
   - Core requirements
   - Key technical decisions made
   - Important constraints identified
   - Risks and mitigations

2. **Validate with user** using **AskUserQuestion**:
   - Present your understanding summary
   - Ask: "Does this capture everything correctly? Anything to add or correct?"
   - Make adjustments based on feedback

### Step 5: Create the Comprehensive Plan

Now create a detailed plan. Because of the extensive brainstorming, this plan should be very thorough:

Break the item into **phases**. Each phase should be:
- **Atomic**: Can be completed independently
- **Commitable**: Results in a working state
- **Small**: Ideally 1-3 files changed
- **Ordered**: Dependencies come first
- **Bisect-compliant**: Must pass all precommit hooks

**Group phases into steps for parallel execution:**
- Phases in the same step have NO dependencies on each other
- Phases in step N+1 may depend on phases in step N (or earlier)
- A step can have 1-4 phases
- When in doubt, put phases in separate steps (safer)

**Criteria for same-step grouping:**
- Different files with no shared imports
- Independent features that don't interact
- Tests for different components

**Criteria for separate steps:**
- One phase creates something another uses
- Shared file modifications
- Interface changes that affect other phases

For each phase, specify:
- Clear tasks (as a checklist)
- Files that will be modified/created
- A suggested commit message
- Bisect considerations
- **Step number** for parallel execution grouping
- **Complexity score** (1-5): Estimate effort/risk
- **Relevant Q&A**: Which questions/answers informed this phase

**Complexity scoring guide:**
| Score | Meaning | Examples |
|-------|---------|----------|
| 1 | Trivial | Config change, add import, rename |
| 2 | Simple | Add function, update UI text, fix typo in logic |
| 3 | Moderate | New component, API endpoint, test suite |
| 4 | Complex | Multi-file refactor, new integration, schema change |
| 5 | High-risk | Architecture change, security-critical, performance-sensitive |

### Step 6: Write the Plan Files

**If updating an existing plan:**
- Use the same `.simplan/items/<slug>/PLAN.md` path
- Preserve completed phases (with `[x]` checkmarks) unless explicitly revising
- Merge new Q&A with existing "Full Q&A Log" section
- Add a "Revision History" section noting this brainstorm session
- Update incomplete phases based on new brainstorming insights

**If creating a new plan:**
- Write to `.simplan/items/<slug>/PLAN.md`

Everything goes in a single `PLAN.md` file (including the full Q&A log).

Use this format:

```markdown
# Plan: <title>

## Executive Summary
<High-level overview of what this item will accomplish>

## Context
<What you learned about the codebase relevant to this item>

## Research Findings
<Key findings from web research - documentation, best practices, patterns discovered>
- **Libraries/APIs**: <relevant docs and usage patterns found>
- **Best Practices**: <industry standards and recommendations>
- **Gotchas**: <common pitfalls to avoid>
- **References**: <links to key documentation or articles consulted>

## Brainstorming Summary

### Questions Asked: <N>

### Requirements & Goals
<Key points from this category>

### User Experience
<Key points from this category>

### Technical Approach
<Key points from this category>

### Edge Cases & Error Handling
<Key points from this category>

### Integration & Dependencies
<Key points from this category>

### Testing & Quality
<Key points from this category>

### Scope & Priorities
<Key points from this category>

### Security & Compliance
<Key points from this category>

### Operations & Maintenance
<Key points from this category>

### Risks & Unknowns
<Key points and mitigations>

## Full Q&A Log
<Complete record of all questions and answers>

## Completion Conditions
<"None specified" if user declined, otherwise list each condition:>

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Tests pass | `npm test` | Exit code 0, all tests green |
| Type check | `npm run typecheck` | No errors |
| Build | `npm run build` | Completes without errors |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1, 2   | <why these are independent> |
| 2    | 3      | <why this depends on step 1> |

> **Parallelism**: Phases within the same step can run in parallel (max 4).

## Phases

### Phase 1: <title>
- **Step**: 1
- **Complexity**: 3
- [ ] <task>
- [ ] <task>
- **Files**: <list of files>
- **Commit message**: `<message>`
- **Bisect note**: <why this phase is self-contained>
- **Informed by**: Q3, Q7, Q12 (reference which Q&A shaped this phase)

### Phase 2: <title>
- **Step**: 1
- **Complexity**: 4
...

## Current Status
- **Current Phase**: Not started
- **Progress**: 0/<total phases>

## Deferred Items
<List any items that came up but are out of scope for this item>

## Revision History
<Only include if this is an update to an existing plan>
- **<date>**: Brainstorm session - <N> additional questions, revised phases X-Y
```

For extensive plans (5+ phases), additional detail files can go in the same folder (e.g., `.simplan/items/<slug>/phase-1.md`).

### Step 7: Update Item Status

Update `.simplan/items/<slug>/ITEM.md`:
- Set status to `PLANNED`

### Step 8: Commit (if configured)

If `.simplan/config` contains `commit_plan=true`:
- Ask user if they want to commit the plan (use AskUserQuestion with "Commit plan?" header, options "Yes" / "No")
- If yes:
  - Stage `.simplan/items/<slug>/PLAN.md` and `.simplan/items/<slug>/ITEM.md`
  - Create commit with message: `plan: brainstorm item <slug>`

### Step 9: Show Result

Display:
- Number of questions asked
- Number of phases created
- Plan summary
- **Plan recap table**:

```markdown
## Plan Recap

| Phase | Step | Cx | Title | Files | Commit |
|-------|------|----|-------|-------|--------|
| 1     | 1    | 3  | <phase title> | <file count> files | `<short commit msg>` |
| 2     | 1    | 4  | <phase title> | <file count> files | `<short commit msg>` |
| 3     | 2    | 3  | <phase title> | <file count> files | `<short commit msg>` |

**Total complexity: 10** (sum of all phases)
```

**Note**: By default, `.simplan/` is gitignored. If `commit_plan=true` is set in `.simplan/config`, remove `.simplan/` from `.gitignore` to enable plan commits.

---

## Guidelines

- **Be thorough but not tedious** - Ask meaningful questions, not filler
- **Listen actively** - Build each question on previous answers
- **Respect user's time** - If they give short answers, take the hint
- **Keep phases small** - More phases is usually better
- **Document everything** - The Q&A log is valuable for future reference
- **Flag scope creep** - Note new items that emerge but keep focus
- **Bisect compliance** - Every phase must pass precommit hooks

---

## Comparison: /item:plan vs /item:brainstorm

| Aspect | /item:plan | /item:brainstorm |
|--------|-----------|-----------------|
| Questions | 1-12 (3 rounds max) | 10-40 (unlimited rounds) |
| Best for | Clear, straightforward items | Complex, ambiguous items |
| Time | Quick | Thorough |
| Output | Concise plan | Comprehensive plan with full Q&A log |

---

## Next Steps

After creating/updating the plan, tell the user:

**For new plans:**
> Item `<slug>` has been thoroughly brainstormed with <N> questions and planned with <M> phases!
>
> Plan: `.simplan/items/<slug>/PLAN.md`
>
> To start executing, run:
> `/item:exec`
>
> Tip: Run `/clear` to reset context before executing.

**For updated plans:**
> Item `<slug>` plan has been revised with <N> additional questions!
>
> Changes: <brief summary of what changed - new phases, revised phases, etc.>
>
> Plan: `.simplan/items/<slug>/PLAN.md`
>
> To continue executing, run:
> `/item:exec`
>
> Tip: Run `/clear` to reset context before executing.
