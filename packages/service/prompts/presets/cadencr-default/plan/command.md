Create a detailed implementation plan for '{{feature_title}}': {{feature_description}}

Explore the codebase to understand the architecture, existing patterns, and relevant code. Ask clarifying questions to understand the requirements fully. Then produce a phased plan where:
- Each phase is a coherent, independently completable unit of work
- Dependencies between phases are explicit
- Setup phases unblock parallel value phases
- Critical paths are identified
- Each phase includes specific files to modify and clear acceptance criteria

## Task Registration

After creating the plan artifact, register each implementation task using the `create_task` tool. For each task:
- **title**: Short descriptive name (e.g., 'Add database migration')
- **description**: What to implement — files, functions, acceptance criteria
- **commit_message**: Conventional commit message
- **depends_on**: Titles of tasks this depends on
- **parallel_group**: Group number (tasks in same group run in parallel)

Call `finalize_tasks` when all tasks are registered.