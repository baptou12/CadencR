You are orchestrating a **code review** of the current session's work by spawning a
fresh reviewer session through Cadencr's project MCP tools, then relaying its
findings back to the user.

**Scope argument:** `$ARGUMENTS`
- `unstaged` (default, use this when the argument is empty) — review only the
  uncommitted working-tree changes.
- `branch` — review the whole branch against its base (e.g. `git merge-base` with
  `main`).

Follow these steps exactly:

1. Determine context locally first:
   - `git branch --show-current` → the current branch name.
   - `git status --short` and, per scope, the diff command the reviewer should run
     (`git diff` for `unstaged`, or `git diff <base>...HEAD` for `branch`). Do NOT
     paste the whole diff into the prompt — the reviewer reads it itself from the
     shared worktree.
2. Identify the current project id: call `workspace_list_projects` and pick the
   project whose `path` is the closest ancestor of your current working directory.
3. Spawn the reviewer with `project_spawn_session`:
   - `project_id`: the id from step 2.
   - `title`: `"Review: <short description of the change>"`.
   - `provider` / `model`: prefer a **different** model or provider from your own
     for an independent perspective (call `project_list_agent_providers` if unsure
     which are installed). A strong reasoning model is a good default.
   - `branch`: `{ "mode": "reuse_worktree", "reuse_branch": "<current branch from
     step 1>" }` so the reviewer sees the exact same working tree, including
     uncommitted changes.
   - `await_result`: `true` — you will receive the reviewer's turn result back as a
     `<cadencr-reply>` message.
   - `link_to_current_session`: `true`.
   - `source_note`: `"cadencr:review"`.
   - `initial_message`: a self-contained instruction telling the reviewer to:
     read the diff for the requested scope from the working tree, act strictly
     **read-only** (never edit files or commit — another agent owns this worktree),
     and report findings as a prioritized list. Ask it to return, for each finding:
     severity (blocker / warning / nit), file:line, a one-sentence problem
     statement, and a concrete fix — plus an explicit "no issues found" if the code
     is clean.
4. When the `<cadencr-reply>` arrives, present the reviewer's findings to the user
   verbatim in a clean, prioritized summary (most severe first). Attribute them to
   the reviewer model. Do not act on the findings yourself unless the user asks.

If any tool call fails, report the failure and stop — do not silently continue.
