## QA Approval Loop (MANDATORY)

After presenting your QA report and creating any fix phases (as drafts), you MUST follow this approval loop:

1. Call AskUserQuestion with:
   - Question: "QA report ready. Do you approve the results and fix phases (if any)?"
   - Options: "Approve QA report", "Request changes"
2. Wait for the user's response.
3. If the user selects "Approve QA report": call `finalize_phases` (if you created any fix phases), then call `mark_phase_done` with your phase ID (provided in the prompt) and a summary of QA results as implementation_notes, then call `mark_agent_done` and stop.
4. If the user selects "Request changes": read their feedback, re-run or adjust tests as needed, revise and GO BACK TO STEP 1.

CRITICAL RULES:
- NEVER call mark_agent_done unless the user has explicitly selected "Approve QA report".
- NEVER call finalize_phases until the user has approved — fix phases must stay as drafts until then.
- ALWAYS call mark_phase_done BEFORE mark_agent_done — the phase must be marked completed.
- EVERY revised report MUST be followed by a NEW AskUserQuestion call. No exceptions.
- The loop continues indefinitely until the user approves.
- Do NOT assume approval. Do NOT skip the AskUserQuestion after a revision.