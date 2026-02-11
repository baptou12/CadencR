---
description: Add a new item to the backlog
argument-hint: [title]
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - AskUserQuestion
---

## Context

Read the `.simplan/items/` directory to see existing items. Each subdirectory is an item slug containing an `ITEM.md` file.

## Configuration

Check `.simplan/config` for settings (key=value format). Relevant setting:
- `commit_plan=true` - If set, commit `.simplan/` changes after modifications

## Task

Add a new item to the backlog. Keep this lightweight - no agent delegation needed.

### Steps

1. **Read existing items**: List `.simplan/items/` subdirectories to check for slug conflicts

2. **Get details**: Use AskUserQuestion to ask for:
   - **Title**: Short, descriptive title (or use from `$ARGUMENTS` if provided)
   - **Type**: Feature or Fix (use labels like "Feature", "Fix")
   - **Description**: What needs to be done

   **AskUserQuestion formatting rules:**
   - Option labels: max 30 characters (use short identifiers like "Feature", "Fix")
   - Headers: max 30 characters
   - Put longer text (full titles, descriptions) in the option `description` field, not the `label`

3. **Generate slug**: Create a URL-friendly slug from the title:
   - Lowercase the title
   - Replace spaces with hyphens
   - Remove special characters
   - Keep it short (max 30 chars)
   - Example: "Add user authentication" → "add-user-authentication"
   - Verify slug doesn't conflict with existing item folders

4. **Create item**: Create the directory and write `.simplan/items/<slug>/ITEM.md`:

```markdown
# <title>
- **Type**: <type-emoji> <Feature|Fix>
- **Status**: 📋 BACKLOG
- **Description**: <description>
```

**Type emojis:**
- ✨ Feature
- 🐛 Fix

**Status emojis:**
- 📋 BACKLOG
- 📝 PLANNED
- 🚧 IN_PROGRESS
- ⏸️ IDLE
- ✅ DONE

5. **Confirm**: Show the added item with its slug

6. **Commit (if configured)**: If `.simplan/config` contains `commit_plan=true`:
   - Ask user if they want to commit the backlog change (use AskUserQuestion with "Commit backlog?" header, options "Yes" / "No")
   - If yes:
     - Stage `.simplan/items/<slug>/ITEM.md`
     - Create commit with message: `plan: add item <slug>`

7. **Assess complexity**: Based on the description, estimate complexity:

   **Simple** (suggest `/item:plan`):
   - Bug fixes with clear reproduction steps
   - Single-file changes
   - Well-defined, narrow scope
   - "Add X to Y" style tasks

   **Complex** (suggest `/item:brainstorm`):
   - New features touching multiple systems
   - Architectural decisions needed
   - Unclear requirements or multiple approaches
   - Integration with external services/APIs
   - Security-sensitive changes
   - Performance optimization without clear target

---

## Next Steps

Based on complexity assessment, recommend:

**For simple items:**
> Item `<slug>` added! This looks straightforward.
>
> To plan this item, run:
> `/item:plan <slug>`
>
> Tip: Run `/clear` to reset context before planning.

**For complex items:**
> Item `<slug>` added! This seems complex—I'd recommend brainstorming first.
>
> To brainstorm this item, run:
> `/item:brainstorm <slug>`
>
> Or if you already know the approach: `/item:plan <slug>`
>
> Tip: Run `/clear` to reset context before planning.
