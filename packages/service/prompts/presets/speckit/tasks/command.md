Decompose the implementation plan for '{{feature_title}}' into an ordered task list.

Reference the specification and plan:
{{artifact:specify}}
{{artifact:plan}}

## Execution Flow

### Step 1: Extract Context
From the plan and spec, identify:
- Tech stack and project conventions
- User stories with their priorities (P1, P2, P3)
- Key entities from the data model
- Interface contracts to implement
- Dependencies between components

### Step 2: Generate Tasks by Phase

**Phase 1 — Setup** (T001-T0xx):
- Project configuration, dependency additions, initial file scaffolding
- These are quick, mechanical tasks

**Phase 2 — Foundational** (T0xx-T0xx):
- Core infrastructure that MUST complete before ANY user story begins
- Data models, base services, shared utilities
- Mark parallelizable tasks with [P]

**Phase 3+ — User Stories** (by priority order):
- Group tasks by user story (US1, US2, US3, ...)
- P1 stories come first, then P2, then P3
- Within each story: models → services → API/UI → integration
- Each story's tasks should be independently implementable after foundational work
- Mark parallelizable tasks with [P]

**Final Phase — Polish**:
- Cross-cutting concerns: error handling hardening, logging, documentation
- Performance optimization if specified in requirements

### Step 3: Validate Coverage
- Every functional requirement (FR-xxx) from the spec must map to at least one task
- Every entity from the data model must have creation/migration tasks
- Every interface contract must have implementation tasks
- Flag any gaps

### Step 4: Format Output
Every task line must follow this exact format:
```
- [ ] [T001] Description with specific file path
- [ ] [T002] [P] Description (parallelizable)
- [ ] [T010] [US1] Description for user story 1
- [ ] [T011] [P] [US1] Parallel task for user story 1
```

## Task Registration

After creating your artifact, register each task using the `create_task` tool. For each task provide:
- **title**: Short, action-oriented name (e.g., 'Add user authentication middleware')
- **description**: Exactly what to implement — files, functions, components
- **commit_message**: Conventional commit (e.g., 'feat: add auth middleware')
- **depends_on**: Titles of tasks this depends on (if any)
- **parallel_group**: Tasks with the same group number can run in parallel

When all tasks are registered, call `finalize_tasks` to proceed to implementation.