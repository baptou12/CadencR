---
description: Remove all DONE items from the backlog
argument-hint:
allowed-tools:
  - Read
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

Purge all completed items from the backlog. Keep this lightweight - no agent delegation needed.

### Steps

1. **Read items**: Read all `.simplan/items/*/ITEM.md` files and identify items with status `✅ DONE`

2. **Check for work**: If no DONE items exist, inform the user and exit

3. **List items to purge**: Show the user all DONE items that will be removed (by slug and title)

4. **Confirm**: Use AskUserQuestion to confirm before proceeding:
   - Option 1: "Yes, purge all"
   - Option 2: "Cancel"

5. **Delete item folders**: For each DONE item, delete its entire `.simplan/items/<slug>/` directory

6. **Commit (if configured)**: If `.simplan/config` contains `commit_plan=true`:
   - Ask user if they want to commit the changes (use AskUserQuestion with "Commit changes?" header, options "Yes" / "No")
   - If yes:
     - Stage the deletions of all purged `.simplan/items/<slug>/` directories
     - Create commit with message: `plan: prune <count> done item(s)`

7. **Show result**: Display summary of purged items and remaining items

---

## Next Steps

Tell the user:

> Purged <count> completed item(s)!
>
> To see your updated backlog, run:
> `/item:progress`
>
> Tip: Run `/clear` to reset context before continuing.
