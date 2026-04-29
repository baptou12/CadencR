# AGENTS.md

This file is the shared repository instruction entrypoint for Codex and OpenCode. `CLAUDE.md` at the repo root mirrors this file for Claude Code compatibility.

## Monorepo Structure

This is a pnpm workspaces + Turborepo monorepo. The desktop app lives in `packages/tauri/` (Tauri v2 + React frontend).

- Run tasks via turbo from root: `pnpm turbo run <task>` (for example `pnpm turbo run lint`, `pnpm turbo run test`)
- Or target the desktop package directly: `pnpm --filter @cadencr/desktop <task>`
- Dev server: `pnpm dev` or `pnpm start` from root. Frontend/service ports are configured via `packages/tauri/.env` and `packages/service/.env` and default to `1420` / `5005`.

## Architecture

The app uses Tauri v2 as the desktop shell with a React frontend. The backend is a Rust API server in `packages/service/` spawned as a sidecar in production. In dev, `pnpm dev` from the repo root runs the service alongside the desktop app via Turborepo. The frontend communicates with the backend via HTTP (Axios) and WebSocket (Zustand store). Folder selection uses `@tauri-apps/plugin-dialog`.

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
- After changing the Rust API surface (utoipa attributes / new handlers): run `pnpm --filter @cadencr/desktop run generate:api`. This re-emits `packages/service/openapi.json` (gitignored, derived from utoipa) and regenerates `packages/tauri/src/api/generated/index.ts` via orval — commit the regenerated TS file. Naming overrides for hooks live in `packages/tauri/orval.transformer.cjs`.
- In Rust source files, keep unit tests inline with the module they cover using `#[cfg(test)]`; do not create dedicated sibling `tests.rs` files for module unit tests
- Do not spread provider-specific logic through shared frontend/backend codepaths; SDKs handle provider communication, adapters unify provider business logic, and shared code should stay provider-neutral
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

Project-specific skills use agent-skills-compatible directories:

- Codex and OpenCode can load `.agents/skills/*/SKILL.md`
- Claude Code loads `.claude/skills/*/SKILL.md`

When a skill needs to work across all three tools, prefer a shared implementation with minimal duplication and keep the Claude-visible entrypoint aligned. If a task clearly matches one of these skills, read the matching skill and follow it before editing:

- `db`
- `qa`
- `finish-job`

## Command Aliases

This repo defines only these shared command-style aliases:

- `/qa [feature]`: run the QA workflow from `.claude/skills/qa/SKILL.md`
- `/finish-job [scope or notes]`: canonical self-contained workflow; simplify the current implementation, close test coverage gaps, propose a commit plan, wait for approval, and after approval continue through the safe commit flow without relying on any other command

OpenCode does not use a repo-local custom command directory in this repo. OpenCode, Codex, and Claude Code should all rely on the shared skills for `db`, `qa`, and `finish-job`. For agents that do not support project slash commands natively, treat these as semantic aliases and follow the mapped skill or workflow.

Codex currently documents built-in slash commands only. For Codex, the supported repo mechanism is the skill in `.agents/skills/*`; users can invoke that skill explicitly, and if `/finish-job` appears in a prompt it should be treated as a plain-language alias for the `finish-job` skill rather than a native custom slash command.
