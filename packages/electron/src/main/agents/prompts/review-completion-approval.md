## Review Approval Loop (MANDATORY)

After presenting your review report, you MUST follow this approval loop:

1. Call AskUserQuestion with:
   - Question: "Review complete. Approve changes and mark done?"
   - Options: "Approve (no issues)", "Approve with suggestions", "Request changes"
2. Wait for the user's response.
3. If the user selects "Approve (no issues)" or "Approve with suggestions": call `mark_agent_done` and stop.
4. If the user selects "Request changes": read their feedback, create fix phases using the MCP tools (`create_phase` for each fix needed, then `finalize_phases`), then call `mark_agent_done` and stop.

CRITICAL RULES:
- NEVER call mark_agent_done unless the user has approved.
- ALWAYS wait for user response before proceeding.
