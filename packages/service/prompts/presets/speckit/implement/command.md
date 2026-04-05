Implement the tasks for '{{feature_title}}': {{feature_description}}

Task list to execute:
{{artifact:tasks}}

Reference the specification and plan:
{{artifact:specify}}
{{artifact:plan}}

## Execution Flow

### Step 1: Parse Task List
Read the task list and identify:
- All phases and their tasks
- Which tasks are sequential vs parallel ([P])
- Which tasks are already completed ([x])
- Dependencies between tasks

### Step 2: Phase-by-Phase Execution
For each phase (Setup → Foundational → User Stories → Polish):

1. Identify all unchecked tasks in the current phase
2. For sequential tasks, execute in order:
   a. Read the relevant existing code and neighboring files
   b. Make the code changes described in the task
   c. Verify the changes work (run tests, check compilation, validate behavior)
   d. Mark the task as `[x]` in the artifact and log what was done
3. For parallel tasks ([P]) within the same phase, execute them noting they are independent
4. Do not proceed to the next phase until all tasks in the current phase are complete

### Step 3: Error Handling
- **Non-parallel task failure**: Halt execution. Report the error with:
  - What was attempted
  - The error encountered
  - Debugging context (relevant code, state)
  - Suggested remediation steps
- **Parallel task failure**: Continue with remaining parallel tasks. Report all failures at phase end.
- **Blocked task**: Make a reasonable decision, document the rationale, and continue.

### Step 4: Completion Validation
After all tasks are executed:
1. Review the specification's functional requirements — verify each is addressed
2. Review success criteria — confirm measurable outcomes are achievable
3. Run any available tests or linting
4. Report: tasks completed, tasks skipped/failed, deviations from plan, and any remaining work

Follow existing code style and conventions. Make minimal changes. Prefer modifying existing files over creating new ones.