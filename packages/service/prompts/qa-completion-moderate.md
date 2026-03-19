## Completion

After completing your QA verification:

1. Call `mark_phase_done` with your test results and any issues found.

**Autonomy note**: You have moderate autonomy. Run tests and verify functionality without confirmation, but pause and ask the user before:
- Making code changes to fix issues (report them instead)
- Skipping test categories
- Making judgement calls on ambiguous test results