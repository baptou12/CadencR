You are orchestrating a **handoff** of the current work to a successor session
through Cadencr's project MCP tools.

**Handoff target or intent:** `$ARGUMENTS`

Follow these steps exactly:

1. Interpret `$ARGUMENTS` as the requested handoff target or intent, such as a
   provider/model or a description of the successor. If it is empty, ask the
   user what they want to hand the work off to.
2. Write a concise, self-contained **handoff brief** that lets a fresh session
   proceed without this conversation's back-scroll. Include:
   - The goal and important constraints.
   - What has been done and any decisions already made.
   - The current worktree and branch state, including relevant changed files,
     checks, failures, or uncommitted work.
   - The specific next step the successor should take.
3. Identify the current project id with `workspace_list_projects` (pick the
   project whose `path` is the closest ancestor of your working directory), and
   get the current branch with `git branch --show-current`. Call
   `project_list_agent_providers` if the requested provider/model needs to be
   resolved.
4. Transfer the brief to the target:
   - Normally call `project_spawn_session` with `project_id`, an appropriate
     `title`, the selected `provider` / `model`, `link_to_current_session: true`,
     `source_note: "cadencr:handoff"`, and the handoff brief as `initial_message`.
   - Use `branch`: `{ "mode": "reuse_worktree", "reuse_branch": "<current branch>" }`
     when the successor should continue the exact same work, including
     uncommitted changes. Use `{ "mode": "new_worktree", "base": "<current branch
     or main>" }` only when the user wants an isolated clean worktree.
   - If the target is an existing session instead, send the brief with
     `project_send_session_message` and `reply: "on_turn_end"`.
   - Set `await_result: true` only when the caller wants the successor's first
     result returned as a `<cadencr-reply>`; otherwise do not wait.
5. Ensure the relationship is recorded as a handoff. The spawn link records the
   spawned relationship; also call `project_link_sessions` with
   `target_session_id: <the spawned or existing target session id>`,
   `link_type: "handoff"`, and `note: "cadencr:handoff"`. The tool uses the
   current session as the source, so gate escalation and sidebar nesting treat
   the target as its handoff successor.
6. Report the target session id and feature/title to the user, noting whether it
   was newly spawned or already existed. If you awaited a result, relay the
   `<cadencr-reply>` when it arrives.

If any tool call fails, report which call failed and stop — do not silently
continue.
