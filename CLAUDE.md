# CLAUDE.md

This file mirrors `AGENTS.md` so Claude Code, Codex, and OpenCode use the same repository guidance.

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
- Keep TypeScript explicit. All functions, parameters, and return values must have explicit types. Prefer interfaces for object shapes and use Zod schemas for runtime validation at boundaries.
- Never swallow errors silently; surface them to the user
- Keep implementations simple and reusable; prefer extracting shared logic over duplication
- Search for existing code before writing new code. Reuse helpers, hooks, utilities, and components instead of duplicating logic.
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

For OpenCode, `opencode.json` also loads the existing `.claude/rules/*.md` files. For Codex, the same repository rules must live in `AGENTS.md` files because Codex does not read `.claude/rules/*.md` directly.

## Shared Skills

Project-specific skills are mirrored for tool compatibility:

- Claude Code and OpenCode: `.claude/skills/*/SKILL.md`
- Codex: `.agents/skills/*/SKILL.md`

The mirrored skills must stay semantically aligned. If a task clearly matches one of these skills, read the matching skill and follow it before editing:

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

Codex currently documents built-in slash commands, not repository-defined custom slash commands. In Codex, treat these aliases as plain-language workflow requests and load the mapped skill or workflow manually.
