# Plan: Electron + React Project Scaffold

## Context
- Greenfield project — only `GOAL.md` exists, no source code yet
- ProductDevR is a desktop app providing a UI for Claude Code
- Tech stack: Electron Forge + Vite, React, TypeScript (strict), Tailwind CSS, shadcn/ui, TanStack Router (hash history), electron-trpc, better-sqlite3
- Package manager: pnpm

## Clarifications
- **Build toolchain**: Electron Forge with Vite plugin (`@electron-forge/plugin-vite`)
- **Package manager**: pnpm
- **TypeScript**: Strict mode
- **Routing**: TanStack Router with `createHashHistory` (works with Electron's `file://` protocol)
- **IPC**: electron-trpc for type-safe main↔renderer communication
- **SQLite**: Full setup — better-sqlite3 with db helper, IPC exposure, sample table/migration
- **Completion conditions**: Build passes, Electron window opens, two pages visible (router works)

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Build passes | `pnpm run make` | Exit code 0, produces output in `out/` |
| TypeScript compiles | `pnpm exec tsc --noEmit` | No errors |
| App starts | `pnpm start` | Electron window opens without crash |
| Router works | Manual verification | Two pages visible and navigable |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1      | Scaffold Electron Forge project with Vite + TS template |
| 2    | 2, 3   | React + Tailwind/shadcn setup and TanStack Router are independent |
| 3    | 4      | electron-trpc depends on React being set up in renderer |
| 4    | 5      | SQLite setup depends on trpc being in place for exposing DB via IPC |

> **Parallelism**: Phases within the same step can run in parallel (max 4).

## Phases

### ✅ Phase 1: Scaffold Electron Forge + Vite + TypeScript project
- **Step**: 1
- **Complexity**: 3
- [x] Run `pnpm create electron-app@latest . --template=vite-typescript` (or equivalent manual setup since we're in an existing dir)
- [x] Verify the generated structure: `src/main.ts`, `src/preload.ts`, `src/renderer.ts`, `forge.config.ts`, `vite.main.config.ts`, `vite.renderer.config.ts`
- [x] Update `tsconfig.json` to enable `strict: true`
- [x] Configure `package.json` scripts and ensure `pnpm start` launches the app
- [x] Add `.gitignore` entries for `node_modules/`, `out/`, `.vite/`
- **Files**: `package.json`, `forge.config.ts`, `tsconfig.json`, `vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.ts`, `src/main.ts`, `src/preload.ts`, `src/renderer.ts`, `src/env.d.ts`, `src/index.css`, `index.html`, `.gitignore`, `.npmrc`
- **Commit message**: `feat: scaffold electron forge project with vite and typescript`
- **Bisect note**: N/A — initial scaffold, app should launch with default content
- **Implementation notes**: Manually scaffolded instead of using `create electron-app` since we are in an existing repo. Added `.npmrc` with `node-linker=hoisted` (required by Electron Forge with pnpm). Added `vite.preload.config.ts` (needed by forge config for preload build target). Added `src/env.d.ts` for Vite dev server URL type declarations. Installed `electron-squirrel-startup` as a dependency.
- **Validation results**: `pnpm exec tsc --noEmit` passes (exit 0). `pnpm run make` passes (exit 0, output in `out/make/`). `pnpm start` not validated (requires display/manual check).
- **Review**: Approved - Clean Electron Forge + Vite + TypeScript scaffold. All files present with real implementations. Both completion conditions (tsc --noEmit, pnpm run make) pass. Standard patterns used throughout.

### ⬜ Phase 2: Add React, Tailwind CSS, and shadcn/ui
- **Step**: 2
- **Complexity**: 3
- [ ] Install React deps: `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`
- [ ] Install Tailwind CSS v4 and configure (or v3 with `tailwind.config.js` + `postcss.config.js`)
- [ ] Initialize shadcn/ui with `pnpm dlx shadcn@latest init`
- [ ] Update `vite.renderer.config.ts` to include React plugin
- [ ] Replace default `renderer.ts` with React entry point (`main.tsx` or `renderer.tsx`) mounting `<App />` to `#root`
- [ ] Update `index.html` to have a `<div id="root">` and import the React entry
- [ ] Create `src/renderer/App.tsx` with a basic component
- [ ] Add global CSS with Tailwind directives
- **Files**: `package.json`, `vite.renderer.config.ts`, `index.html`, `src/renderer.ts` → `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/index.css`, `tailwind.config.js`, `postcss.config.js`, `components.json`
- **Commit message**: `feat: add react, tailwind css, and shadcn/ui to renderer`
- **Bisect note**: Must update both vite config and entry point together so the build doesn't break

### ⬜ Phase 3: Set up TanStack Router with two pages
- **Step**: 2
- **Complexity**: 3
- [ ] Install `@tanstack/react-router` and `@tanstack/router-vite-plugin`
- [ ] Configure `createHashHistory` for Electron compatibility
- [ ] Create route tree: root route with layout, `/` (Home page), `/settings` (Settings page)
- [ ] Create `src/renderer/routes/__root.tsx` with navigation layout (sidebar or nav bar with links to both pages)
- [ ] Create `src/renderer/routes/index.tsx` (Home page)
- [ ] Create `src/renderer/routes/settings.tsx` (Settings page)
- [ ] Create router instance in `src/renderer/router.ts` with hash history
- [ ] Mount `<RouterProvider>` in `App.tsx`
- [ ] Add TanStack router plugin to `vite.renderer.config.ts`
- **Files**: `package.json`, `src/renderer/router.ts`, `src/renderer/routes/__root.tsx`, `src/renderer/routes/index.tsx`, `src/renderer/routes/settings.tsx`, `src/renderer/App.tsx`, `vite.renderer.config.ts`
- **Commit message**: `feat: add tanstack router with home and settings pages`
- **Bisect note**: Router + pages + provider must all be added together for the app to render

### ⬜ Phase 4: Set up electron-trpc IPC layer
- **Step**: 3
- **Complexity**: 3
- [ ] Install `electron-trpc`, `@trpc/server`, `@trpc/client`, `@trpc/react-query`, `@tanstack/react-query`, `zod`
- [ ] Create tRPC router in `src/main/trpc/router.ts` with a sample `hello` procedure
- [ ] Create tRPC context and procedure helpers in `src/main/trpc/trpc.ts`
- [ ] Update `src/preload.ts` to call `exposeElectronTRPC()`
- [ ] Call `createIPCHandler` in `src/main.ts` after window creation
- [ ] Create tRPC client in `src/renderer/trpc.ts` using `ipcLink`
- [ ] Wrap React app with `QueryClientProvider` and tRPC provider
- [ ] Add a sample query call in one of the pages to verify IPC works
- **Files**: `package.json`, `src/main/trpc/trpc.ts`, `src/main/trpc/router.ts`, `src/main.ts`, `src/preload.ts`, `src/renderer/trpc.ts`, `src/renderer/App.tsx`, `src/renderer/routes/index.tsx`
- **Commit message**: `feat: add electron-trpc IPC layer with sample procedure`
- **Bisect note**: Preload, main handler, and renderer client must all be wired together in one phase

### ⬜ Phase 5: Set up SQLite with better-sqlite3
- **Step**: 4
- **Complexity**: 3
- [ ] Install `better-sqlite3` and `@types/better-sqlite3`
- [ ] Create `src/main/db/database.ts` — initializes DB file in app's userData path, creates connection
- [ ] Create `src/main/db/migrations.ts` — simple migration runner with a `migrations` version table
- [ ] Add a sample `settings` table (key-value store) as the first migration
- [ ] Expose DB operations via tRPC procedures: `settings.get`, `settings.set`, `settings.list`
- [ ] Add `better-sqlite3` to Vite's external modules in `vite.main.config.ts`
- [ ] Wire up a settings read/write in the Settings page to verify end-to-end
- **Files**: `package.json`, `src/main/db/database.ts`, `src/main/db/migrations.ts`, `src/main/trpc/router.ts`, `vite.main.config.ts`, `src/renderer/routes/settings.tsx`
- **Commit message**: `feat: add sqlite database with settings table and trpc integration`
- **Bisect note**: DB init, migration, trpc procedures, and vite externals must be configured together

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Phase 2 & 3 (Step 2)
- **Progress**: 1/5
