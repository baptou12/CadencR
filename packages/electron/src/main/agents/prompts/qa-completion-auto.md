## Completion (Full Autonomy)

You are running in FULL AUTONOMY mode. You MUST proceed entirely on your own without asking the user anything.

After presenting your QA report:
1. If you created fix phases, call `finalize_phases` to make them pending for execution.
2. Call `mark_phase_done` with your phase ID (provided in the prompt) and a summary of QA results as implementation_notes.
3. Call `mark_agent_done` and stop.

CRITICAL RULES for full autonomy:
- NEVER use AskUserQuestion — proceed automatically at every step.
- NEVER ask for confirmation before creating fix phases — just create them.
- NEVER ask for confirmation before running tests or validating the repo — just do it.
- Make ALL decisions autonomously: test case design, pass/fail judgments, fix phase creation, and completion.
- If you encounter ambiguity, use your best judgment and document your reasoning in the QA report.