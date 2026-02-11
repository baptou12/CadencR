---
description: Execute a phase of an item
argument-hint: [slug] [--no-review|--review]
allowed-tools:
  - Read
  - Write
  - Edit
  - Task
  - Bash
  - Glob
  - AskUserQuestion
---

## Context

Read the `.simplan/items/` directory to see existing items. Each subdirectory is an item slug containing an `ITEM.md` file (metadata) and a `PLAN.md` file (the plan).

## Configuration

Check `.simplan/config` for settings (key=value format). Relevant settings:
- `commit_plan=true` - If set, commit `.simplan/` changes after code commits
- `review=true|false` - Whether to run the review step after execution (defaults to `true` if not specified). Can be overridden per-invocation with `--review` or `--no-review` flags.

## Environment Detection

Check if running on Claude Code web by running: `echo $CLAUDE_CODE_REMOTE`
- If the output is `true`, you are on Claude Code web - **skip all AskUserQuestion calls** (they lock the process)
- If empty or unset, you are on CLI and can use AskUserQuestion normally

## Status Emojis

When displaying or updating item statuses, use these emojis:
- 📋 `BACKLOG` - Not yet planned
- 📝 `PLANNED` - Has a plan, ready to execute
- ⏸️ `IDLE` - Started but paused
- 🔄 `IN_PROGRESS` - Currently being worked on
- ✅ `DONE` - Completed

## Task

Execute a phase for the current item by delegating to agents.

### Arguments
- `$ARGUMENTS` may contain:
  - Item slug (optional - auto-selects if not provided)
  - `--no-review` flag (optional - skip the review step)
  - `--review` flag (optional - force the review step, overrides config)

### Steps

1. **Parse arguments**: Extract slug (optional) and `--no-review`/`--review` flags from `$ARGUMENTS`. Determine whether to review: flags take priority over config. If no flag is passed, check `.simplan/config` for `review=true|false` (defaults to `true` if not specified).

2. **Select item**:
   - If slug provided: use that item (must be `PLANNED` or `IDLE`)
   - If no slug:
     - Read all `.simplan/items/*/ITEM.md` files
     - First: Look for any item with status `IN_PROGRESS` (continue it)
     - If none: Pick the first item with status `PLANNED` or `IDLE` (alphabetical by slug)
   - If no eligible items exist, tell user to run `/item:plan` first

3. **Update statuses**:
   - Read all `.simplan/items/*/ITEM.md` files
   - Move ALL `IN_PROGRESS` items to `IDLE` (update their ITEM.md)
   - Set the selected item to `IN_PROGRESS` (update its ITEM.md)
   - This ensures only one item is ever in progress at a time

4. **Get plan**: Read `.simplan/items/<slug>/PLAN.md`

5a. **Extract completion conditions** (if present):
    - Look for the "Completion Conditions" section in the plan
    - If it contains a table with validation commands and expected outcomes, extract them
    - These will be passed to the executor agent to run after implementation
    - If "None specified", skip completion condition checking

6. **Determine next step**:
   - Parse the "Execution Steps" table from the plan (if present)
   - If no step table exists, treat each phase as its own step (backward compatibility)
   - Find the lowest step number that has incomplete phases (phases with ⬜ or 🔄, not ✅)
   - Collect ALL incomplete phases from that step

7. **Single phase vs parallel decision**:

   **If only 1 phase in the step:**
   - Proceed with single-phase execution (step 8)

   **If 2-4 phases in the step:**
   - Display the phases that could run in parallel with their titles
   - Use **AskUserQuestion** (labels max 30 chars, headers max 30 chars):
     - "Run all in parallel" (description: "Recommended - runs all N phases concurrently")
     - "Run one at a time" (description: "Sequential execution, starting with Phase X")
   - If parallel: go to step 8a
   - If sequential: go to step 8 with first phase only

8. **Execute via simplan:exec** (single phase):

   **First, read the plan file and extract the phase content.** Then inline it into the Task prompt:

   ```
   Task(
     prompt="Execute Phase <N> of `<slug>`.

     Plan file: .simplan/items/<slug>/PLAN.md

     ## Phase Content (from plan)
     <INLINE THE FULL PHASE SECTION HERE - title, tasks, files, commit message, bisect note>

     ## Item Context
     - **Title**: <item title from ITEM.md>
     - **Description**: <item description from ITEM.md>

     ## Completion Conditions
     <If completion conditions exist in the plan, INLINE THE TABLE HERE:>
     | Condition | Validation Command | Expected Outcome |
     | ... | ... | ... |
     <If none specified, write: "None specified - skip validation step">

     Follow your execution process:
     1. Understand the phase requirements (already provided above)
     2. Implement the changes as specified
     3. Run completion condition validations (if specified) and iterate until they pass
     4. Update the plan with implementation notes
     5. Mark tasks as complete",
     subagent_type="simplan:exec",
     description="Execute Phase <N> of <slug>"
   )
   ```

   **Why inline?** The @ syntax doesn't cross Task boundaries. Inlining ensures the agent has correct context immediately without spending tokens reading files.

   After execution completes, go to step 9.

8a. **Execute via simplan:exec** (parallel phases):

    **First, read the plan file and extract each phase's content.** Then launch up to 4 Task calls **in a single message** (parallel execution):

    ```
    Task(
      prompt="Execute Phase <N> of `<slug>`.

      Plan file: .simplan/items/<slug>/PLAN.md

      ## Phase Content (from plan)
      <INLINE THE FULL PHASE SECTION HERE - title, tasks, files, commit message, bisect note>

      ## Item Context
      - **Title**: <item title from ITEM.md>
      - **Description**: <item description from ITEM.md>

      ## Completion Conditions
      <If completion conditions exist in the plan, INLINE THE TABLE HERE:>
      | Condition | Validation Command | Expected Outcome |
      | ... | ... | ... |
      <If none specified, write: "None specified - skip validation step">

      IMPORTANT: Other phases are running in parallel. Only modify files listed in YOUR phase.

      Follow your execution process:
      1. Understand the phase requirements (already provided above)
      2. Implement the changes as specified
      3. Run completion condition validations (if specified) and iterate until they pass
      4. Update the plan with implementation notes
      5. Mark tasks as complete",
      subagent_type="simplan:exec",
      description="Execute Phase <N> of <slug>"
    )
    ```

    **Why inline?** The @ syntax doesn't cross Task boundaries. Inlining ensures each agent has its phase context immediately.

    Wait for ALL tasks to complete, then go to step 9a.

9. **Review via simplan:review** (single phase) — **skip this step if review is disabled; go directly to step 10**:
   ```
   Task(
     prompt="Review Phase <N> of `<slug>`.

     **Problem to solve**: <copy the phase title and objective from the plan - what needs to be done, NOT how>

     Plan file: .simplan/items/<slug>/PLAN.md (only for updating status after review)

     ## Completion Conditions
     <If completion conditions exist in the plan, INLINE THE TABLE HERE:>
     | Condition | Validation Command | Expected Outcome |
     | ... | ... | ... |
     <If none specified, write: "None specified">

     Review the code changes with fresh eyes. Use `git diff` to see what changed.
     Validate quality and correctness based on the problem statement alone.
     If completion conditions are specified, verify they all pass before approving.",
     subagent_type="simplan:review",
     description="Review Phase <N> of <slug>"
   )
   ```
   After review completes, go to step 10.

9a. **Review via simplan:review** (combined review for parallel phases) — **skip this step if review is disabled; go directly to step 10**:
    Single review for all phases that ran in parallel:
    ```
    Task(
      prompt="Review Phases <X>, <Y>, <Z> of `<slug>`.

      **Problems solved** (review ALL):
      - Phase X: <title and objective>
      - Phase Y: <title and objective>
      - Phase Z: <title and objective>

      Plan file: .simplan/items/<slug>/PLAN.md (only for updating status after review)

      ## Completion Conditions
      <If completion conditions exist in the plan, INLINE THE TABLE HERE:>
      | Condition | Validation Command | Expected Outcome |
      | ... | ... | ... |
      <If none specified, write: "None specified">

      Review the combined code changes with fresh eyes. Use `git diff` to see what changed.
      Validate quality and correctness for EACH problem statement.
      If completion conditions are specified, verify they all pass before approving.
      Mark ALL phases if approved, or identify which specific phases need work.",
      subagent_type="simplan:review",
      description="Review Phases <X>, <Y>, <Z> of <slug>"
    )
    ```
    After review completes, go to step 10.

10. **Update phase statuses in plan file**: After review approval, YOU (the command) must update the plan:
    - For each phase that was just executed and approved:
      - Change the phase emoji from ⬜ or 🔄 to ✅
      - Example: `### ⬜ Phase 1:` → `### ✅ Phase 1:`
    - Update the `## Current Status` section:
      - Set `**Current Phase**:` to the next incomplete phase (or "All phases complete")
      - Update `**Progress**:` count (e.g., "2/4")

11. **Update item status if done**: After updating the plan:
    - Re-read the plan file to check if all phases are now complete (all have ✅ emoji)
    - If all phases done, update `.simplan/items/<slug>/ITEM.md` status to `DONE`

12. **Confirm**:
    - If `$CLAUDE_CODE_REMOTE` is `true`, skip confirmation and proceed directly to commit
    - If `$SIMPLAN_RALPH` is `true`, skip confirmation and proceed directly to commit (ralph loop handles flow)
    - Otherwise, use AskUserQuestion to ask user to confirm and commit the changes (labels max 30 chars, headers max 30 chars; put details in descriptions)

13. **Commit**: If user confirmed (or on web), create **one commit per phase** (even for parallel execution):
    - For each phase in the step:
      - Stage the code files modified during that phase (listed in the phase's "Files" section)
      - If `.simplan/config` contains `commit_plan=true`, also stage:
        - The plan file `.simplan/items/<slug>/PLAN.md` (with updated phase statuses)
        - `.simplan/items/<slug>/ITEM.md` (if status changed)
      - Create commit with the phase's suggested commit message
    - Do NOT use `git add -A` or `git add .` - explicitly add only the specified files

---

## After Completion

Once the phase is committed, **stop**. Do not continue to the next phase.

If there are remaining phases, tell the user:

> Phase complete!
>
> To continue with the next phase, run:
> `/item:exec`
>
> Tip: Run `/clear` to reset context before the next phase.
