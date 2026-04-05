Create an implementation plan for '{{feature_title}}': {{feature_description}}

Reference the specification:
{{prior_artifacts}}

## Execution Flow

### Step 1: Codebase Exploration
Deeply explore the codebase to understand:
- Language, framework, and dependency versions
- Data storage patterns (database, file system, state management)
- Testing approach and tools
- Project structure and conventions
- Existing patterns that this feature must follow

### Step 2: Extract Technical Context
Document the project's technical foundation:
- **Language/Version**: e.g., TypeScript 5.x, Rust 1.75
- **Primary Dependencies**: e.g., React, Axum, SQLite
- **Storage**: e.g., SQLite, Zustand store, file system
- **Testing**: e.g., Vitest, cargo test
- **Constraints**: e.g., < 200ms p95, offline-capable
Mark unknowns as "NEEDS CLARIFICATION" for Phase 0 resolution.

### Step 3: Phase 0 — Research
Resolve all unknowns before making design decisions:
1. For each NEEDS CLARIFICATION in the spec or technical context — create a research task
2. For each dependency or technology choice — find best practices in the codebase
3. For each integration point — identify existing patterns

Consolidate findings using this format for each decision:
- **Decision**: [what was chosen]
- **Rationale**: [why this approach]
- **Alternatives considered**: [what else was evaluated and why it was rejected]

### Step 4: Phase 1 — Design
With all unknowns resolved, design the solution:

**Data Model** (if feature involves data):
- Entity names, fields, relationships
- Validation rules derived from requirements
- State transitions if applicable

**Interface Contracts** (if feature exposes interfaces):
- API endpoints with request/response shapes
- Component props and event interfaces
- Message/event schemas for async communication

**Component Architecture**:
- New components/modules to create with responsibilities
- Existing components to modify with change descriptions
- Data flow between components

**Integration Points**:
- How the feature connects to existing systems
- Migration strategy for database or state changes
- Backward compatibility approach

### Step 5: Validate Coverage
Verify every functional requirement (FR-xxx) from the spec has a clear implementation path in the plan. Flag any gaps.

The plan should be specific enough that a developer can implement each part independently.