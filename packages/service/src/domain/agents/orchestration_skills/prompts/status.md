Give the user a **read-only** org-wide readout of the Cadencr sessions related to
this one: the tree of spawned sessions with their live status and any blocked gates.
Do not spawn, message, or modify anything.

Follow these steps:

1. Read the relationship graph with `workspace_session_graph` (anchor it on your own
   session if you know its id; otherwise call it with no `session_id` for the recent
   graph). This gives the spawn / message / handoff edges between sessions.
2. List the current project's sessions with `project_list_sessions` to get names and
   recency for the nodes in the graph.
3. For each relevant session (your own and anything you spawned or that is linked to
   you), call `project_get_session_status` to get its live state — whether it is
   working, idle, waiting on a gate, or finished.
4. For any session that looks blocked or awaiting input, call
   `project_list_pending_gates` to surface the specific permission / plan / question
   gate it is waiting on.
5. Render a compact tree to the user:
   - One node per session: title, provider/model if known, and live status.
   - Indent spawned children under their parent following the graph edges.
   - Flag blocked sessions clearly (e.g. `⛔ waiting: <gate summary>`), and note who
     can answer the gate.
   - End with a one-line summary: how many sessions are active, idle, and blocked.

If `$ARGUMENTS` names a specific session id or title, focus the readout on that
session and its subtree.

This command is strictly read-only. If any tool call fails, report which one and
show what you could gather — do not silently drop it.
