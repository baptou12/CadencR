# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this?

ProductDevR is an Electron desktop app that provides a UI for Claude Code. It manages codebases as projects, breaks work into features, and orchestrates AI agents (plan, brainstorm, execute, risk, review, session) via the Claude Agent SDK.

## Commands

- `pnpm start` — Run the app in development mode (electron-forge + vite)
- `pnpm run lint` — Lint with oxlint
- `pnpm run package` — Package the app for distribution
- `pnpm run make` — Build distributable installers

## Architecture

**Electron app with three Vite build targets** configured in `forge.config.ts`:

- **Main process** (`src/main.ts`) — Electron main, creates BrowserWindow, sets up tRPC IPC handler
- **Preload** (`src/preload.ts`) — Electron preload script
- **Renderer** (`src/renderer/`) — React UI

**IPC layer uses tRPC v10 via `electron-trpc`:**

- Main process exposes `appRouter` (`src/main/trpc/router.ts`) with sub-routers: `settings`, `projects`, `features`, `agents`, `git`, `diffComments`
- Renderer consumes via `@trpc/react-query` + `@tanstack/react-query` v4 (`src/renderer/trpc.ts`)
- Must stay on tRPC v10 and React Query v4 for `electron-trpc` compatibility

**Database:** SQLite via `better-sqlite3` (`src/main/db/database.ts`, `src/main/db/migrations.ts`). Tables: `settings`, `projects`, `project_settings`, `features`, `feature_settings`, `plans`, `phases`, `agent_sessions`, `agent_messages`, `diff_comments`.

**Routing:** TanStack Router with file-based routes in `src/renderer/routes/`. Route tree is auto-generated in `routeTree.gen.ts`.

**Styling:** Tailwind CSS v4 + shadcn/ui (new-york style, neutral base). The `@` alias maps to `src/renderer/` for shadcn component paths.

## Key Subsystems

**Agent orchestration** (`src/main/agents/`): Spawns Claude Code CLI subprocesses via `@anthropic-ai/claude-agent-sdk`. `subprocess-manager.ts` is the core — handles spawning, streaming, question interception, file diff capture. `unified-agent.ts` is the single entry point for all agent types. `ipc-bridge.ts` bridges events to renderer and persists messages to DB.

**Git worktrees** (`src/main/git/worktree.ts`): Each feature gets an isolated git worktree at `~/.productdevr/<project>/<branch>/`.

**State management**: No store library — all state flows through tRPC queries + React Query cache. Cache invalidation via IPC `db:updated` events from main process. Key hooks: `useSessionState` (agent stream state), `useFeatureState` (workflow view state), `useWorkflowAgents` (multi-agent orchestration).

## Rules

- Do NOT upgrade tRPC beyond v10 or React Query beyond v4 — `electron-trpc` requires these exact major versions
- Use `better-sqlite3` synchronous API — no async DB calls
- New DB tables require a numbered migration in `migrations.ts` (current: 13 migrations)
- Agent types: `plan`, `brainstorm`, `execute`, `risk`, `review`, `session` — always go through `unified-agent.ts`
- Model resolution cascades: feature settings → project settings → global settings → default (Opus 4.6)
- All IPC events from agents flow through `ipc-bridge.ts` — never send IPC directly from agent files
- Renderer imports use `@/` alias (maps to `src/renderer/`)
- shadcn components go in `src/renderer/components/ui/`, custom components in `src/renderer/components/`
- Routes are file-based in `src/renderer/routes/` — the route tree auto-generates, do not edit `routeTree.gen.ts`
- Externalize native modules (e.g. `better-sqlite3`) in `vite.main.config.ts`
- Features have two types: `feature` (multi-agent workflow) and `session` (free-form chat)
