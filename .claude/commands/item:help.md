---
description: Explain the simplan workflow and commands
allowed-tools:
---

## Simplan Workflow

**Simplan is for fast engineering, not vibe coding.**

This framework is designed for developers managing production code with serious quality concerns. It optimizes context usage by delegating to focused sub-agents, enforces bisect-safe commits, and keeps plans local (`.simplan/` is gitignored—these are your personal working notes, not project documentation).

### Overview

```
BACKLOG → PLANNED → IN_PROGRESS → DONE
   ↑         ↑           ↑    ↓      ↑
 /add      /plan       /exec ↔ IDLE /review
```

**Statuses**:
- `BACKLOG` - Work identified, not yet planned
- `PLANNED` - Plan created, ready to execute
- `IN_PROGRESS` - Currently being worked on (only one at a time)
- `IDLE` - Started but paused (switched to another item)
- `DONE` - All phases completed

### Commands

#### `/item:add` - Add a new item to the backlog
**Goal**: Capture work that needs to be done.

Creates a new backlog item with a title, type (Feature/Fix), and description. Items start in `BACKLOG` status, waiting to be planned. Each item gets its own folder at `.simplan/items/<slug>/`.

**When to use**: When you identify new work, bugs to fix, or features to build.

---

#### `/item:plan [slug]` - Plan an item before coding
**Goal**: Break work into atomic, committable phases.

Takes a backlog item and creates a detailed plan by:
- Exploring the codebase to understand architecture
- Asking clarifying questions interactively (1-12 questions, max 3 rounds)
- Splitting work into small, reviewable phases
- Writing the plan to `.simplan/items/<slug>/PLAN.md`

Updates item status from `BACKLOG` → `PLANNED`.

**When to use**: For straightforward items where requirements are mostly clear.

---

#### `/item:brainstorm [slug]` - Brainstorm extensively before planning
**Goal**: Deep-dive into complex items through extensive Q&A.

Like `/item:plan` but with much more thorough exploration:
- Asks 10-40 questions across multiple rounds
- Covers 10 categories: requirements, UX, technical approach, edge cases, integration, testing, scope, security, operations, and risks
- Creates comprehensive plans with full Q&A logs included in PLAN.md
- Documents which questions informed each phase

Updates item status from `BACKLOG` → `PLANNED`.

**When to use**: For complex features, architectural decisions, or items with unclear requirements. When you need to deeply understand before committing to an approach.

---

#### `/item:exec [slug]` - Execute a phase
**Goal**: Implement one phase at a time with immediate review.

Executes a single phase from the plan:
1. Selects the item (auto-selects if no slug given)
2. Moves any other `IN_PROGRESS` items to `IDLE`
3. Runs the `simplexecutor` agent to make code changes
4. Runs the `simpreviewer` agent to validate the changes
5. Shows changes for manual confirmation
6. Creates a commit with a descriptive message

**Item selection**:
- If slug provided: uses that item
- If no slug: continues `IN_PROGRESS` item, or picks first `PLANNED`/`IDLE`

**When to use**: After planning, execute phases one by one. Review each before moving to the next.

---

#### `/item:review [slug]` - Review and complete an item
**Goal**: Ensure all work is complete and properly recorded.

Reviews a completed item to:
- Verify all phases were implemented
- Check commits exist for each phase
- Update any incomplete checkboxes in the plan
- Mark the item as `DONE`

**When to use**: After executing all phases, run review to finalize the item.

---

#### `/item:delete [slug]` - Remove an item from backlog
**Goal**: Clean up items that are no longer needed.

Removes an item's entire folder (`.simplan/items/<slug>/`).

**When to use**: When an item is cancelled, duplicated, or no longer relevant.

---

#### `/item:updatesimplan` - Update simplan framework
**Goal**: Get the latest simplan commands and agents.

Downloads and installs the latest version of simplan. Detects whether you have a global or local installation and updates accordingly. Shows the changelog with explanations of new features and offers to configure new options.

**What it updates**: Commands (`/item:*`) and agents (simplan:exec, simplan:review).
**What it preserves**: Your project data (`.simplan/items/`, `.simplan/config`).

**When to use**: Periodically, or when you want new features and bug fixes.

---

### Best Practices

1. **Plan before coding** - Always run `/item:plan` or `/item:brainstorm` before `/item:exec`
2. **Choose the right planning depth**:
   - `/item:plan` - For clear, straightforward items (quick: 1-12 questions)
   - `/item:brainstorm` - For complex or ambiguous items (thorough: 10-40 questions)
3. **Atomic phases** - Each phase should be a single, focused change
4. **Review each phase** - Don't rush through phases; review changes before committing
5. **Keep plans concise** - Focus on APIs and data structures, not full implementations
6. **One item at a time** - Complete an item before starting another

### File Structure

```
.simplan/
├── config                          # Optional configuration (key=value format)
└── items/
    ├── add-user-auth/              # Item folder (slug = folder name)
    │   ├── ITEM.md                 # Item metadata (title, type, status, description)
    │   ├── PLAN.md                 # The plan (phases, steps, completion conditions)
    │   └── phase-1.md              # Optional additional phase details
    ├── fix-pagination/
    │   ├── ITEM.md
    │   └── PLAN.md
    └── improve-search/
        └── ITEM.md                 # No plan yet (BACKLOG)
```

### Configuration

Simplan can be configured via `.simplan/config` using `key=value` format (one per line).

**Available options:**

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `commit_plan` | `true`/`false` | `false` | Commit `.simplan/` changes alongside code |

**Example `.simplan/config`:**
```
commit_plan=true
```

**`commit_plan`**: When enabled, simplan commands will offer to commit plan file changes (ITEM.md, PLAN.md) alongside your code commits. Each commit requires explicit confirmation.

**Note**: By default, `.simplan/` is gitignored. If you enable `commit_plan=true`, you'll need to remove `.simplan/` from your `.gitignore` for commits to work.

### Item Format

Each item is stored in its own folder at `.simplan/items/<slug>/ITEM.md`:

```markdown
# Add user authentication
- **Type**: ✨ Feature
- **Status**: 📋 BACKLOG
- **Description**: Implement login/logout functionality
```

- The slug is the folder name (no slug field needed)
- The plan is always at `PLAN.md` in the same folder (no plan field needed)

---

---

## Next Steps

> To see your current backlog, run:
> `/item:progress`
>
> Or add a new item with `/item:add`
>
> Tip: Run `/clear` to reset context before starting work.
