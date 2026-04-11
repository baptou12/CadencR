---
name: sync-presets
description: >
  Sync workflow preset prompts from upstream framework source repos. Use when the user wants to
  update preset prompts to match the latest version of BMAD, Speckit, or OpenSpec frameworks.
  Triggers on: "sync presets", "update presets", "sync bmad", "sync speckit", "sync openspec",
  "update framework prompts", "pull latest framework".
---

# Sync Preset Prompts from Upstream Frameworks

Sync Cadence workflow preset prompts with their upstream framework source repositories.

Argument: preset name (`bmad`, `speckit`, `openspec`, or `all`). Defaults to `all`.

## Preset Source Mapping

| Preset | Repo | Prompts Location |
|--------|------|-----------------|
| bmad | `bmad-code-org/BMAD-METHOD` | `.claude/commands/` and agent persona files |
| speckit | `github/spec-kit` | `.claude/skills/` |
| openspec | `Fission-AI/OpenSpec` | `.claude/commands/opsx/` |

## Local File Structure

Prompts live in `packages/service/prompts/presets/{preset}/{phase}/`:
- `system.md` - system prompt for the agent
- `command.md` - user command or instruction
- `artifact.md` - expected output template

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

1. Check the latest upstream version and compare it with `manifest.toml`.
2. Fetch the upstream prompt content.
3. Adapt the content to Cadence template variables:
   - `{{project_name}}`
   - `{{project_path}}`
   - `{{feature_title}}`
   - `{{feature_description}}`
   - `{{date}}`
   - `{{prior_artifacts}}`
   - `{{artifact:slug}}`
4. Write updated prompt files.
5. Update `manifest.toml` and the `VERSION` constant in `packages/service/src/domain/ws_workflow/presets/templates/{preset}.rs`.
6. Run `cargo build` to verify `include_str!` paths and compilation.
7. Report which preset(s) changed and the version updates.

Preserve upstream intent while adapting variables and Cadence-specific sections.
