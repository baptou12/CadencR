# AGENTS.md

This file is the shared repository instruction entrypoint for Codex and OpenCode. `CLAUDE.md` at the repo root mirrors this file for Claude Code compatibility.

## Monorepo Structure

This is a pnpm workspaces + Turborepo monorepo. The desktop app lives in `packages/tauri/` (Tauri v2 + React frontend).

- Run tasks via turbo from root: `pnpm turbo run <task>` (for example `pnpm turbo run lint`, `pnpm turbo run test`)
- Or target the desktop package directly: `pnpm --filter @cadence/desktop <task>`
- Dev server: `pnpm dev` or `pnpm start` from root (frontend on port `1420`, service on port `5005`)

## Architecture

The app uses Tauri v2 as the desktop shell with a React frontend. The backend is a Rust API server in `packages/service/` spawned as a sidecar in production. In dev mode, run `cadence-service` manually. The frontend communicates with the backend via HTTP (Axios) and WebSocket (Zustand store). Folder selection uses `@tauri-apps/plugin-dialog`.

Frontend path alias: `@` -> `packages/tauri/src/` (for example `import { foo } from "@/lib/foo"`).

## Critical Constraints

- Use `pnpm` instead of `npm` or `yarn`
- Lint with `pnpm run lint` (oxlint via turbo)
- Test with `pnpm test` (vitest via turbo)
- Never use `any`; use `unknown` plus narrowing when needed
- Never swallow errors silently; surface them to the user
- Keep implementations simple and reusable; prefer extracting shared logic over duplication
- Avoid unnecessary re-renders, redundant network calls, and heavy main-thread work
- Do not run `pnpm orval`; `packages/tauri/src/api/generated/index.ts` is hand-maintained
- No file longer than 400 lines; refactor before crossing the limit
- No function longer than 100 lines; split long functions before finishing

## Scoped Rules

Additional scoped rules are defined in nearby `AGENTS.md` files:

- `packages/tauri/src/AGENTS.md`
- `packages/tauri/src/components/AGENTS.md`
- `packages/tauri/src/routes/AGENTS.md`
- `packages/service/migrations/AGENTS.md`

For OpenCode, `opencode.json` also loads the existing `.claude/rules/*.md` files so the Claude-era rule set remains available without rewriting every rule.

## Claude Skills

Project-specific skills live in `.claude/skills/*/SKILL.md`. If a task clearly matches one of these skills, read that skill and follow it before editing:

- `db`
- `qa`
- `sync-presets`
- `test-commit`

## Command Aliases

This repo also defines shared command-style aliases:

- `/qa [feature]`: run the QA workflow from `.claude/skills/qa/SKILL.md`
- `/test [scope]`: use `.claude/skills/test-commit/SKILL.md` for the testing workflow only; do not create a git commit unless explicitly requested
- `/commit [message or notes]`: use `.claude/skills/test-commit/SKILL.md` for the full test-and-commit workflow
- `/test-commit [message or notes]`: same as `/commit`

OpenCode gets real slash commands from `.opencode/command/*.md`. For agents that do not support project slash commands natively, treat these as semantic aliases and follow the mapped skill or workflow.
