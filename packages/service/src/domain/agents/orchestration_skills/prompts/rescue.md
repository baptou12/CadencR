You are **stuck** and invoking the escape hatch: hand this conversation to a fresh
model with a different perspective and bring back an unblock suggestion.

The whole point is a *different provider or model* — do not spawn your own model.

Follow these steps exactly:

1. Write a tight, self-contained **situation summary** the fresh model can act on
   without any of this conversation's history. Include:
   - The goal — what the user is ultimately trying to achieve.
   - What has been tried and what happened (approaches, errors, dead ends).
   - The **specific stuck point** — the exact question, error, or decision that is
     blocking progress right now.
   - Relevant files/paths and any constraints (from the repo, the task, or the
     user). Reference `$ARGUMENTS` if the user passed a hint about where to focus.
2. Identify the current project id with `workspace_list_projects` (the project whose
   `path` is the closest ancestor of your working directory).
3. Spawn the rescue session with `project_spawn_session`:
   - `project_id`: from step 2.
   - `title`: `"Rescue: <the stuck point in a few words>"`.
   - `provider` / `model`: deliberately choose a **different provider or model**
     from your own (call `project_list_agent_providers` to see what is installed).
     A fresh vendor's model is ideal — that is where the new perspective comes from.
   - `branch`: `{ "mode": "reuse_worktree", "reuse_branch": "<current branch>" }`
     (get it via `git branch --show-current`) so the helper sees the same tree.
   - `await_result`: `true`.
   - `link_to_current_session`: `true`.
   - `source_note`: `"cadencr:rescue"`.
   - `initial_message`: the situation summary from step 1, ending with an explicit
     request: "You are a fresh pair of eyes on a stuck task. Diagnose the blocker
     and propose one concrete next step, plus one alternative. Be specific."
4. After spawning, also record the relationship with `project_link_sessions`
   (`link_type: "handoff"`, `note: "cadencr:rescue"`) so the graph shows this was a
   handoff.
5. When the `<cadencr-reply>` arrives, relay the fresh model's suggestion to the
   user clearly, attributed to that model, and ask whether they want you to act on
   it.

If any tool call fails, report the failure and stop — do not silently continue.
