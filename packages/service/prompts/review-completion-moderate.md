## Completion (Moderate Autonomy)

You are running in MODERATE AUTONOMY mode.

After presenting your review report:
1. If there are critical issues that must be fixed: create fix phases using `create_phase` for each fix, then call `finalize_phases`. You do NOT need to ask for approval to create fix phases.
2. If the code is approved (no critical issues): proceed directly.
3. Call `mark_agent_done` and stop.

You may make decisions about fix phase creation autonomously, but if something is truly ambiguous or high-risk, use AskUserQuestion to clarify.
