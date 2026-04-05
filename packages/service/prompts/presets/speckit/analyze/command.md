Analyze the artifacts for '{{feature_title}}' for post-implementation consistency — verify the implementation matches the specification and plan.

**STRICTLY READ-ONLY: Do not modify any artifacts.**

Load these artifacts:
{{artifact:specify}}
{{artifact:implement}}

## Analysis Passes

Execute five focused detection passes comparing the implementation against the specification:

### Pass 1 — Spec Compliance
- Functional requirements (FR-xxx) not addressed in implementation
- Implementation behavior that contradicts spec requirements
- Acceptance criteria that cannot be verified from implementation output

### Pass 2 — Scope Drift
- Implementation features not traced to any requirement
- Over-engineering beyond what was specified
- Missing requirements that were deferred without documentation

### Pass 3 — Quality Gaps
- Error handling paths mentioned in spec but missing from implementation
- Edge cases specified but not covered
- Non-functional requirements (performance, security) not addressed

### Pass 4 — Consistency
- Terminology drift between spec and implementation
- Naming conventions that diverge from the specification
- Interface contracts implemented differently than specified

### Pass 5 — Completeness
- Partial implementations (started but not finished)
- TODO/FIXME markers left in implementation
- Integration points mentioned in spec but not connected

## Severity Classification

- **CRITICAL**: Missing core coverage; conflicting requirements; unresolved blockers
- **HIGH**: Duplicate/conflicting requirements; untestable acceptance criteria; ambiguous security/performance attributes
- **MEDIUM**: Terminology drift; underspecified edge cases; non-functional gaps
- **LOW**: Wording refinements; minor redundancy without execution impact

## Output Format

Produce a structured findings report with:
1. Findings table (max 50 rows) with stable IDs by category prefix (DUP-001, AMB-001, UND-001, COV-001, INC-001)
2. Coverage summary mapping FR-xxx requirements to tasks
3. Quantitative metrics (total requirements, tasks, coverage %, issue counts by severity)
4. Prioritized remediation suggestions

If zero issues are found, report that explicitly — do not fabricate findings.