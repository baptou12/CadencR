<!-- auto-generated from .claude/rules/ — edit those files and run pnpm build:agents-md -->

# AGENTS.md

These rules apply to `packages/desktop/src/components/`.

### components
_Applies to: `packages/desktop/src/components/**`_

shadcn/ui primitives live in the `ui/` subdirectory (new-york style, neutral base); everything else goes directly in `components/`. Don't hand-roll a button, dialog, dropdown, or input — check `ui/` first.
