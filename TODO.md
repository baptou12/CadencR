## FIX
- [ ] [agent] When plan is visible, restarting the app should show the plan again.

## FEAT
- [ ] [agent] handle background agents
- [ ] [workflow] Merging strategies
- [ ] [editor] META+SHIFT+F to search for a string in the file
- [ ] [workflow] Commit detection
- [ ] [workflow] template variable autocompletion
- [ ] [workflow] during onboarding, the back button next to "workflow" text is useless
- [ ] [workflow] dependencies vizualization
- [ ] [workflow] cadence phase ordering (prd -> plan -> execute -> review -> execute -> done)
### Framework parity gaps
Capabilities needed to fully support BMAD, Speckit, and OpenSpec workflows natively.

- [ ] [workflow] multi-artifact output per phase
  OpenSpec `propose` creates 4 artifacts (proposal, specs, design, tasks) in one step. Currently a phase produces exactly one artifact. Needs a way to output multiple typed artifacts from a single phase execution.
- [ ] [workflow] phase iteration/refinement loops
  Speckit `specify` iterates up to 3 times to refine the spec until quality checks pass. Currently phases run once. Needs a loop-until-satisfied mechanism with a configurable max iteration count.
- [ ] [workflow] flexible analyze phase ordering
  Speckit runs `analyze` BEFORE `implement` as a pre-implementation quality gate (cross-artifact consistency check). Currently phase order is fixed per preset. Either make order configurable per-workflow, or allow a phase to appear both before and after another.
- [ ] [workflow] add checklist phase
  Speckit generates domain-specific "unit tests for requirements" — a checklist that validates spec completeness before implementation. New phase type, could be a built-in Speckit phase or a generic reusable phase.
- [ ] [workflow] add clarify phase
  Speckit has a standalone `clarify` command: ask up to 5 targeted questions to reduce ambiguity in the spec, then encode answers back into the spec artifact. Needs ability for a phase to modify a prior phase's artifact.
- [ ] [workflow] sub-agent dispatch within a phase
  BMAD agents can spawn sub-agents mid-phase (e.g., Analyst fans out research agents for parallel discovery). Currently one agent per phase. Needs a way for the phase agent to delegate sub-tasks to child agents and collect results.
- [ ] [workflow] delta spec sync on archive
  OpenSpec archive compares change-level specs with project-level specs and prompts for sync. Needs a concept of project-level specs (persistent across features) vs feature-level artifacts (scoped to one workflow).
- [ ] [workflow] per-preset extension hooks
  BMAD and Speckit support before/after hooks per phase via config files (e.g., `.specify/extensions.yml`). Needs a hook system in the workflow definition that runs user-defined actions before or after phase execution.
- [ ] [global] Rework command palette
- [ ] [global] Theming
- [ ] [global] custom commands + custom schedules
- [ ] [global] remote workspaces
