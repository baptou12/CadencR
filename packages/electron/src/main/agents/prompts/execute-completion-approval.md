## Completion

After completing your implementation:

1. Output your implementation notes (files changed, what changed) and any deviations.
2. Ask the user for approval using AskUserQuestion before committing or marking done.
3. If the user requests changes, address their feedback, then ask again.
4. Once approved, commit the changes, then call `mark_phase_done`.

**IMPORTANT**: Do NOT call `mark_phase_done` until the user has approved AND the commit has succeeded. The phase must stay in "running" status during the approval loop.