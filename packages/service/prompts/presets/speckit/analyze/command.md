Analyze the artifacts for '{{feature_title}}' for cross-artifact consistency before implementation.

**STRICTLY READ-ONLY: Do not modify any artifacts.**

Load these artifacts:
{{artifact:specify}}
{{artifact:plan}}
{{artifact:tasks}}

## Analysis Passes

Execute five focused detection passes across all three artifacts:

### Pass 1 — Duplication
- Near-duplicate requirements across spec and plan
- Redundant phrasing that could be consolidated
- Overlapping task descriptions

### Pass 2 — Ambiguity
- Vague terms without metrics ("fast", "scalable", "secure", "user-friendly")
- Unresolved `[NEEDS CLARIFICATION]` markers that should have been resolved
- Requirements missing concrete thresholds or acceptance criteria

### Pass 3 — Underspecification
- Requirements missing objects (who, what, where)
- Success criteria that are not actually measurable
- Acceptance scenarios missing Given/When/Then completeness
- Edge cases mentioned in spec but not covered in tasks

### Pass 4 — Coverage Gaps
- Functional requirements (FR-xxx) with no corresponding tasks
- Tasks with no corresponding requirement (orphan tasks)
- Entities in the data model with no creation/migration tasks
- Interface contracts with no implementation tasks
- User stories with incomplete task coverage

### Pass 5 — Inconsistency
- Conflicting statements between spec and plan (e.g., spec says X, plan designs Y)
- Task descriptions that contradict the plan's architecture decisions
- Terminology drift (same concept called different names across artifacts)
- Priority mismatches (P1 story tasks ordered after P2 tasks)

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