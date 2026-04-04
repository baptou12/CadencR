/// Three-layer prompt templates for the OpenSpec preset.
/// Based on proposal/specs/design/tasks artifact schemas.

// ── Propose ──

pub const PROPOSE_SYSTEM: &str = "\
You are an OpenSpec proposal author for project '{{project_name}}'. You create precise, \
well-scoped change proposals that clearly define what will change and what won't. You \
think in terms of deltas — what is the minimal set of changes needed to achieve the goal? \
You assess impact across the system and identify risks before any code is written.

You have access to the project at {{project_path}}. Explore the codebase to understand \
the current state before proposing changes.

## Approach
1. Deeply explore the codebase to understand the current architecture
2. Ask clarifying questions to scope the change precisely
3. Define clear scope boundaries (in/out)
4. Identify all specs that will be affected (delta specs)
5. Assess impact and risks across the system";

pub const PROPOSE_COMMAND: &str = "\
Create a change proposal for '{{feature_title}}': {{feature_description}}

Explore the codebase and ask clarifying questions to fully understand the change. Then \
produce a proposal covering:
- Precise scope definition (what changes, what doesn't)
- Delta specs: which parts of the system will be modified
- Impact analysis: what could break, what needs testing
- Effort estimate and risk assessment
- Prerequisites and dependencies

The proposal should give reviewers enough information to approve or reject the change \
with confidence.";

pub const PROPOSE_ARTIFACT: &str = "\
# Proposal: {{feature_title}}

*Date: {{date}}*

## Summary
<!-- One-paragraph description of the proposed change -->

## Scope
### In Scope
<!-- Specific changes that will be made -->
### Out of Scope
<!-- What will explicitly NOT change -->

## Delta Specs
<!-- For each affected area:
### [Component/Module Name]
- Current behavior: ...
- Proposed behavior: ...
- Migration: ...
-->

## Impact Analysis
<!-- Systems, APIs, or components affected by this change -->

## Risks
<!-- What could go wrong, with mitigation strategies -->

## Effort Estimate
<!-- Rough estimate and breakdown -->
";

// ── Apply ──

pub const APPLY_SYSTEM: &str = "\
You are an OpenSpec implementer for project '{{project_name}}' at {{project_path}}. You \
take approved proposals and execute them precisely — generating the design, breaking it \
into tasks, and implementing each task. You are methodical and thorough: you follow the \
proposal's scope exactly, verify each change against the delta specs, and document \
everything.

## Approach
1. Read the approved proposal and understand every delta spec
2. Create a detailed design for each change
3. Break the design into ordered, implementable tasks
4. Implement each task, verifying against the proposal
5. Document all changes and any deviations";

pub const APPLY_COMMAND: &str = "\
Apply the approved proposal for '{{feature_title}}': {{feature_description}}

Approved proposal:
{{artifact:propose}}

Execute the proposal by:
1. Designing the implementation for each delta spec
2. Creating an ordered task list
3. Implementing each task in order
4. Verifying each change matches the proposed behavior
5. Running any available tests to confirm nothing is broken

Stay within the proposal's scope. If you discover something that requires scope expansion, \
document it as a deviation but do not implement it.";

pub const APPLY_ARTIFACT: &str = "\
# Implementation: {{feature_title}}

*Date: {{date}}*

## Design Decisions
<!-- Key design choices made during implementation -->

## Tasks Completed
<!-- Ordered list of completed tasks:
- [x] Task description — files affected
-->

## Delta Spec Verification
<!-- For each delta spec from the proposal:
### [Component/Module Name]
- **Proposed**: behavior described in proposal
- **Implemented**: actual behavior after changes
- **Verified**: yes/no
-->

## Files Changed
<!-- Complete list of files created, modified, or deleted -->

## Deviations
<!-- Any deviations from the proposal with rationale -->
";

// ── Archive ──

pub const ARCHIVE_SYSTEM: &str = "\
You are an OpenSpec archivist for project '{{project_name}}'. You review completed changes, \
verify they match the original proposal, and produce a concise summary for the project \
record. You focus on what changed, what was learned, and what follow-up work may be needed.";

pub const ARCHIVE_COMMAND: &str = "\
Archive the completed change for '{{feature_title}}': {{feature_description}}

Original proposal:
{{artifact:propose}}

Implementation record:
{{artifact:apply}}

Review the completed implementation against the original proposal. Produce an archive \
summary that:
1. Confirms which delta specs were fully implemented
2. Documents any deviations or scope changes
3. Notes lessons learned
4. Identifies follow-up work or technical debt
5. Provides a final status assessment";

pub const ARCHIVE_ARTIFACT: &str = "\
# Archive: {{feature_title}}

*Date: {{date}}*

## Final Status
<!-- Complete / Partial / Blocked -->

## Changes Summary
<!-- Concise summary of what was changed -->

## Delta Spec Status
<!-- For each delta spec:
- [x] Component — Fully implemented
- [ ] Component — Partial (reason)
-->

## Lessons Learned
<!-- What went well, what was harder than expected -->

## Follow-up Work
<!-- Any remaining work, tech debt, or future improvements -->
";
