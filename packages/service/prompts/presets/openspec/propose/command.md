Create a change proposal for '{{feature_title}}': {{feature_description}}

Explore the codebase and ask clarifying questions to fully understand the change. Then produce a proposal covering:
- **Why**: The problem or opportunity motivating this change
- **What Changes**: Specific modifications, marking any BREAKING changes
- **Capabilities**: New and modified capabilities with kebab-case names — these bridge the proposal to implementation
- **Impact**: Affected code, APIs, dependencies, and systems

Focus on the "why" not the "how" — implementation details belong in the apply phase. Keep the proposal concise (1-2 pages). The proposal should give reviewers enough information to approve or reject the change with confidence.

## Task Registration

After creating the proposal artifact, decompose the implementation into tasks using the `create_task` tool. For each task:
- **title**: Action-oriented name
- **description**: What changes to make
- **commit_message**: Conventional commit message
- **depends_on**: Titles of prerequisite tasks
- **parallel_group**: Group number for parallel execution

Call `finalize_tasks` when all tasks are registered.