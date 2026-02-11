# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this?

ProductDevR is an Electron desktop app that provides a UI for Claude Code. It manages codebases as projects, breaks work into features, and orchestrates AI agents for planning, execution, risk analysis, and code review.

## Commands

- `pnpm start` — Run the app in development mode (electron-forge + vite)
- `pnpm run lint` — Lint with ESLint
- `pnpm run package` — Package the app for distribution
- `pnpm run make` — Build distributable installers

## Architecture

**Electron app with three Vite build targets** configured in `forge.config.ts`:
- **Main process** (`src/main.ts`) — Electron main, creates BrowserWindow, sets up tRPC IPC handler
- **Preload** (`src/preload.ts`) — Electron preload script
- **Renderer** (`src/renderer/`) — React UI

**IPC layer uses tRPC v10 via `electron-trpc`:**
- Main process exposes `appRouter` (`src/main/trpc/router.ts`) with sub-routers: `settings`, `projects`, `features`
- Renderer consumes via `@trpc/react-query` + `@tanstack/react-query` v4 (`src/renderer/trpc.ts`)
- Must stay on tRPC v10 and React Query v4 for `electron-trpc` compatibility

**Database:** SQLite via `better-sqlite3` (`src/main/db/database.ts`, `src/main/db/migrations.ts`). Tables: `settings`, `projects`, `features`.

**Routing:** TanStack Router with file-based routes in `src/renderer/routes/`. Route tree is auto-generated in `routeTree.gen.ts`.

**Styling:** Tailwind CSS v4 + shadcn/ui (new-york style, neutral base). The `@` alias maps to `src/renderer/` for shadcn component paths.
