Write a detailed specification for '{{feature_title}}': {{feature_description}}

## Execution Flow

### Step 1: Codebase Exploration
Explore the codebase to understand existing behavior, architecture, patterns, and conventions relevant to this feature.

### Step 2: Parse Description & Extract Concepts
From the feature description, identify:
- **Actors**: Who interacts with this feature (user roles, external systems)
- **Actions**: What operations are performed
- **Data entities**: What information is created, read, updated, or deleted
- **Constraints**: Performance, security, compliance, or business rules mentioned or implied

### Step 3: Apply Reasonable Defaults
For unspecified aspects, assume sensible defaults and document them in the Assumptions section rather than asking. Reasonable defaults include:
- Standard error handling patterns (validation errors, network failures, timeouts)
- Common data retention policies (follow existing project patterns)
- Conventional performance targets (< 200ms for UI interactions, < 1s for data operations)
- Authentication/authorization following the project's existing patterns
- Accessibility following WCAG 2.1 AA unless otherwise specified
- Standard pagination, rate limiting, and caching strategies

### Step 4: Handle Unclear Aspects
If critical ambiguities remain after applying defaults, mark them with `[NEEDS CLARIFICATION]`. Rules:
- **Maximum 3** markers across the entire specification
- Prioritized by impact: scope > security/privacy > UX > technical
- Each marker must explain what is unclear and suggest options (A, B, C)
- Never use markers for things that can be reasonably assumed

### Step 5: Write User Scenarios
Create prioritized user stories as independently testable journeys:
- Each story should deliver standalone value (viable MVP slice)
- Assign priorities: P1 (critical), P2 (important), P3 (nice-to-have)
- Include Given/When/Then acceptance scenarios for each story
- Add edge cases section covering boundary conditions and error scenarios

### Step 6: Generate Requirements
Write functional requirements using MUST/SHOULD/MAY language:
- Each requirement gets a unique ID (FR-001, FR-002, ...)
- Requirements must be specific and testable
- Identify key entities with their attributes and relationships (no implementation details)

### Step 7: Define Success Criteria
Success criteria must be:
- **Measurable**: Include concrete metrics (percentages, durations, volume rates)
- **Technology-agnostic**: No framework, language, or database references
- **User-focused**: Framed from user/business perspective
- **Verifiable**: Testable without implementation knowledge

### Step 8: Quality Validation
Review the specification for completeness:
- All mandatory sections are filled (User Scenarios, Requirements, Success Criteria, Assumptions)
- Requirements are unambiguous and testable
- No more than 3 clarification markers
- User stories are independently testable
- Success criteria are measurable
- If gaps exist, iterate (up to 3 refinement passes)

Produce a specification that fully defines what must be built, without prescribing how.