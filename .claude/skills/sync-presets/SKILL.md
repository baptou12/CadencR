---
name: sync-presets
description: >
  Sync workflow preset prompts from upstream framework source repos. Use when the user wants to
  update preset prompts to match the latest version of BMAD, Speckit, or OpenSpec frameworks.
  Triggers on: "sync presets", "update presets", "sync bmad", "sync speckit", "sync openspec",
  "update framework prompts", "pull latest framework".
user-invocable: true
allowed-tools: Bash(*), Read(*), Write(*), Edit(*), Glob(*), Grep(*), WebFetch(*), WebSearch(*)
---

# Sync Preset Prompts from Upstream Frameworks

Sync Cadence workflow preset prompts with their upstream framework source repositories.

**Argument** (`$ARGUMENTS`): preset name (`bmad`, `speckit`, `openspec`, or `all`). Defaults to `all`.

## Preset Source Mapping

| Preset | Repo | Prompts Location |
|--------|------|-----------------|
| bmad | `bmad-code-org/BMAD-METHOD` | `.claude/commands/` and agent persona files |
| speckit | `github/spec-kit` | `.claude/skills/` |
| openspec | `Fission-AI/OpenSpec` | `.claude/commands/opsx/` |

## Local File Structure

Prompts live in `packages/service/prompts/presets/{preset}/{phase}/`:
- `system.md` — system prompt for the agent
- `command.md` — user command/instruction
- `artifact.md` — expected output template

Each preset has a `manifest.toml` tracking source version:
```toml
[source]
name = "BMAD"
repo = "bmad-code-org/BMAD-METHOD"
version = "6.2.2"
synced_at = "2026-04-05"
```

## Sync Workflow

For each preset to sync:

### 1. Check latest version
```bash
gh api repos/{owner}/{repo}/releases/latest --jq '.tag_name'
```
Compare with version in `manifest.toml`. Report if already up-to-date.

### 2. Fetch upstream prompt content
Use `gh api` or raw GitHub content to fetch the framework's agent/command markdown files:
- **BMAD**: Fetch agent personas and command files from the repo. Map BMAD's agents (Analyst, Product Manager, Architect, Developer) to Cadence phases (analysis, planning, solutioning, implementation).
- **Speckit**: Fetch skill files. Map speckit commands (specify, plan, tasks, implement, analyze) to Cadence phases.
- **OpenSpec**: Fetch command files. Map OpenSpec workflows (propose, apply, archive) to Cadence phases.

### 3. Adapt to Cadence template format
Upstream prompts use their own variable formats. Transform them to Cadence's template variables:
- `{{project_name}}` — project name
- `{{project_path}}` — project filesystem path
- `{{feature_title}}` — feature/workflow name
- `{{feature_description}}` — feature description
- `{{date}}` — current date
- `{{prior_artifacts}}` — all prior phase artifacts concatenated
- `{{artifact:slug}}` — reference a specific phase's artifact by slug

Keep the upstream prompt's intent and structure. Adapt variable references. Preserve any Cadence-specific sections like "Task Registration" blocks for phases that use `create_task`/`finalize_tasks`.

### 4. Write updated files
Write the adapted prompts to the corresponding `system.md`, `command.md`, `artifact.md` files.

### 5. Update manifest and VERSION constant
- Update `manifest.toml` with new version and today's date for `synced_at`
- Update `VERSION` constant in `packages/service/src/domain/ws_workflow/presets/templates/{preset}.rs`

### 6. Verify
Run `cargo build` to confirm `include_str!` paths still resolve and everything compiles.

### 7. Report
Show a summary: which preset(s) were synced, old version → new version, files changed.

## Phase Mapping Reference

### BMAD
| Upstream Agent | Cadence Phase Slug | Phase Name |
|---------------|-------------------|------------|
| Analyst | analysis | Analysis |
| Product Manager | planning | Planning |
| Architect | solutioning | Solutioning |
| Developer | implementation | Implementation |

### Speckit
| Upstream Command | Cadence Phase Slug | Phase Name |
|-----------------|-------------------|------------|
| speckit-specify | specify | Specify |
| speckit-plan | plan | Plan |
| speckit-tasks | tasks | Tasks |
| speckit-implement | implement | Implement |
| (analyze is Cadence-specific) | analyze | Analyze |

### OpenSpec
| Upstream Workflow | Cadence Phase Slug | Phase Name |
|------------------|-------------------|------------|
| propose | propose | Propose |
| apply | apply | Apply |
| archive | archive | Archive |
