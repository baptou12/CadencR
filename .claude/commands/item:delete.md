---
description: Remove an item from the backlog
argument-hint: [slug]
allowed-tools:
  - Read
  - Bash
  - Glob
  - AskUserQuestion
---

## Context

Read the `.simplan/items/` directory to see existing items. Each subdirectory is an item slug containing an `ITEM.md` file and optionally other files.

## Configuration

Check `.simplan/config` for settings (key=value format). Relevant setting:
- `commit_plan=true` - If set, commit `.simplan/` changes after modifications

## Task

Delete an item from the backlog. Keep this lightweight - no agent delegation needed.

### Steps

1. **Parse arguments**: Get slug from `$ARGUMENTS`

2. **Validate**: If no slug provided, read `.simplan/items/` and list all items (read each `ITEM.md`), then use AskUserQuestion to ask which one to delete (use slugs as option labels, put titles in descriptions)

3. **Confirm deletion**: Use AskUserQuestion to confirm before proceeding (use short labels like "Yes, delete", "Cancel")

4. **Delete item folder**: Remove the entire `.simplan/items/<slug>/` directory (includes ITEM.md, PLAN.md, and any other files)

5. **Commit (if configured)**: If `.simplan/config` contains `commit_plan=true`:
   - Ask user if they want to commit the changes (use AskUserQuestion with "Commit changes?" header, options "Yes" / "No")
   - If yes:
     - Stage the deletion of `.simplan/items/<slug>/`
     - Create commit with message: `plan: delete item <slug>`

6. **Show result**: Confirm the item was deleted

---

## Next Steps

Tell the user:

> Item deleted!
>
> To see your updated backlog, run:
> `/item:progress`
>
> Tip: Run `/clear` to reset context before continuing.
