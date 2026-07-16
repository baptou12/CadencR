## CadencR workflow boundary

This virtual skill is self-contained. Follow the workflow below using the attached CadencR MCP tools and the user's active project/worktree. Do not search the filesystem for CadencR's installation, source code, internal prompts, or skill definitions to learn how to execute it. If a required MCP tool is unavailable, report that limitation instead.

## Reactive inter-agent delivery

- Inter-agent messages steer an active target turn by default. Use
  `delivery: "next_turn"` only when the workflow explicitly requires delayed,
  post-turn handling.
- A spawned session with `follow.gates: true` automatically steers permission,
  plan, and question `<cadencr-gate>` events to the parent.
- `follow.completion: true` and `reply: "on_turn_end"` automatically steer the
  resulting `<cadencr-reply>` to the requester.
- An intentional user stop is not a child failure. It emits no failed reply;
  the completion follow stays armed for the result of later steered guidance.
- After enabling follow or requesting a reply, wait for those pushed events. Do **not** poll
  `project_read_session_tail`, `project_get_session_status`, or
  `project_list_pending_gates`. Those tools are recovery/debug snapshots only.
