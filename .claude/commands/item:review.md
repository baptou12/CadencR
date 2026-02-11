---
description: Review a completed item and update plan status
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
---

## Context

Read the `.simplan/items/` directory to see existing items. Each subdirectory is an item slug containing an `ITEM.md` file (metadata) and a `PLAN.md` file (the plan).

## Configuration

Check `.simplan/config` for settings (key=value format). Relevant setting:
- `commit_plan=true` - If set, commit `.simplan/` changes after review updates

## Status Emojis

When displaying or updating item statuses, use these emojis:
- 📋 `BACKLOG` - Not yet planned
- 📝 `PLANNED` - Has a plan, ready to execute
- ⏸️ `IDLE` - Started but paused
- 🔄 `IN_PROGRESS` - Currently being worked on
- ✅ `DONE` - Completed

## Task

Validate item `$ARGUMENTS` by delegating to the **simplan:review** agent.

### Steps

1. **Parse arguments**: Get slug from `$ARGUMENTS`

2. **Validate**: If no slug provided, read `.simplan/items/` and find items that need validation (IN_PROGRESS or DONE status), then use AskUserQuestion to ask which one to validate (use slugs as option labels, put titles in descriptions; all labels max 30 chars)

3. **Get plan**: Read `.simplan/items/<slug>/PLAN.md`

4. **Delegate to simplan:review**: Use the Task tool to spawn the review agent:
   ```
   Task(
     prompt="Validate item `<slug>`.

     Item file: .simplan/items/<slug>/ITEM.md
     Plan file: .simplan/items/<slug>/PLAN.md

     Follow your review process:
     1. Read the plan and review all changes
     2. Compare actual code state with the plan
     3. Check if all phases were properly completed
     4. Verify commits exist for each phase (code files only - .simplan/ is gitignored)
     5. Update the plan file with completion status
     6. Update item status to DONE in ITEM.md if all phases complete
     7. Generate summary of what was accomplished",
     subagent_type="simplan:review",
     description="Validate item <slug>"
   )
   ```

5. **Commit (if configured)**: If `.simplan/config` contains `commit_plan=true`:
   - Ask user if they want to commit the review updates (use AskUserQuestion with "Commit review?" header, options "Yes" / "No")
   - If yes:
     - Stage `.simplan/items/<slug>/PLAN.md` (with updated review status)
     - Stage `.simplan/items/<slug>/ITEM.md` (if status changed to DONE)
     - Create commit with message: `plan: review item <slug> - <status>`

6. **Show result**: Display the validation summary to the user

---

## Next Steps

Based on validation result, tell the user:

**If item is marked DONE:**
> Item `<slug>` complete!
>
> To see remaining work, run:
> `/item:progress`
>
> Tip: Run `/clear` to reset context before starting new work.

**If issues were found:**
> Validation found issues that need to be fixed.
>
> To fix and re-run, run:
> `/item:exec <slug>`
>
> Tip: Run `/clear` to reset context before fixing.
