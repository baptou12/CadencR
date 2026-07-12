You are orchestrating a **parallel fan-out** of independent sub-tasks through
Cadencr's project MCP tools, then consolidating the child sessions' results for
the user.

**Task breakdown:** `$ARGUMENTS`

Follow these steps exactly:

1. Establish the independent sub-tasks:
   - Treat `$ARGUMENTS` as the user's task breakdown.
   - If it is empty, ask the user to list the independent sub-tasks, or infer a
     breakdown from the current conversation and ask the user to confirm it.
   - Do not fan out work with ordering dependencies or overlapping edits. Keep
     the batch to a sensible size; do not spawn an unreasonable number of
     sessions at once.
2. Determine context locally:
   - `git branch --show-current` -> the current branch. Use `main` as the base if
     there is no suitable current branch.
   - Call `workspace_list_projects` and pick the project whose `path` is the
     closest ancestor of your current working directory.
3. For **each** confirmed independent sub-task, spawn one child with
   `project_spawn_session`. Issue all independent spawn calls concurrently; do
   not wait for one child's result before spawning the others:
   - `project_id`: the id from step 2.
   - `title`: `"Parallel: <short sub-task description>"`.
   - `provider` / `model`: use the appropriate defaults unless the user requested
     specific targets. Different models or providers per child are fine; call
     `project_list_agent_providers` if a requested target must be resolved.
   - `branch`: `{ "mode": "new_worktree", "base": "<current branch or main>" }`
     so concurrent edits cannot collide.
   - `await_result`: `true`.
   - `link_to_current_session`: `true`.
   - `source_note`: `"cadencr:parallelize"`.
   - `initial_message`: a self-contained instruction describing **only** that
     sub-task, its goal, relevant context and constraints, and the result the
     child should return. Do not make the child depend on this conversation's
     back-scroll or on another child.
4. Each child's turn result returns as a `<cadencr-reply>`. As replies arrive,
   collect them and present one consolidated summary keyed by sub-task. Include
   each child's outcome and worktree/branch when available, and clearly flag any
   failed sub-task.

If any spawn fails, report which sub-task failed and do not initiate any
additional work — do not silently continue.
