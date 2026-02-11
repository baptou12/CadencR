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

| Condition           | Validation Command       | Expected Outcome                       |
| ------------------- | ------------------------ | -------------------------------------- |
| Build passes        | `pnpm run make`          | Exit code 0, produces output in `out/` |
| TypeScript compiles | `pnpm exec tsc --noEmit` | No errors                              |
| App starts          | `pnpm start`             | Electron window opens without crash    |
| Router works        | Manual verification      | Two pages visible and navigable        |

## Execution Steps

| Step | Phases | Description                                                         |
| ---- | ------ | ------------------------------------------------------------------- |
| 1    | 1      | Scaffold Electron Forge project with Vite + TS template             |
| 2    | 2, 3   | React + Tailwind/shadcn setup and TanStack Router are independent   |
| 3    | 4      | electron-trpc depends on React being set up in renderer             |
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

### ✅ Phase 2: Add React, Tailwind CSS, and shadcn/ui

- **Step**: 2
- **Complexity**: 3
- [x] Install React deps: `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`
- [x] Install Tailwind CSS v4 and configure (or v3 with `tailwind.config.js` + `postcss.config.js`)
- [x] Initialize shadcn/ui with `pnpm dlx shadcn@latest init`
- [x] Update `vite.renderer.config.ts` to include React plugin
- [x] Replace default `renderer.ts` with React entry point (`main.tsx` or `renderer.tsx`) mounting `<App />` to `#root`
- [x] Update `index.html` to have a `<div id="root">` and import the React entry
- [x] Create `src/renderer/App.tsx` with a basic component
- [x] Add global CSS with Tailwind directives
- **Files**: `package.json`, `vite.renderer.config.ts`, `index.html`, `src/renderer.ts` → `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/index.css`, `tailwind.config.js`, `postcss.config.js`, `components.json`
- **Commit message**: `feat: add react, tailwind css, and shadcn/ui to renderer`
- **Bisect note**: Must update both vite config and entry point together so the build doesn't break
- **Implementation notes**: Used Tailwind CSS v4 with `@tailwindcss/vite` plugin (no `tailwind.config.js` or `postcss.config.js` needed). shadcn/ui auto-init failed (framework detection), so manually created `components.json`, `src/renderer/lib/utils.ts` with `cn()` helper, and full oklch CSS variable theme in `index.css`. Added `@` path alias in both `vite.renderer.config.ts` (resolve.alias) and `tsconfig.json` (paths). Installed `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react` as shadcn utility deps. Added `jsx: "react-jsx"` to tsconfig. Removed old `src/renderer.ts` and `src/index.css`.
- **Validation results**: `pnpm exec tsc --noEmit` passes (exit 0). `pnpm run make` passes (exit 0, artifacts in `out/make/`). `pnpm start` and router validation deferred to manual check.
- **Review**: Approved - Tailwind v4 with @tailwindcss/vite plugin, full shadcn/ui theme with oklch CSS variables, cn() utility, proper @ alias in both vite and tsconfig. Clean and complete.

### ✅ Phase 3: Set up TanStack Router with two pages

- **Step**: 2
- **Complexity**: 3
- [x] Install `@tanstack/react-router` and `@tanstack/router-vite-plugin`
- [x] Configure `createHashHistory` for Electron compatibility
- [x] Create route tree: root route with layout, `/` (Home page), `/settings` (Settings page)
- [x] Create `src/renderer/routes/__root.tsx` with navigation layout (sidebar or nav bar with links to both pages)
- [x] Create `src/renderer/routes/index.tsx` (Home page)
- [x] Create `src/renderer/routes/settings.tsx` (Settings page)
- [x] Create router instance in `src/renderer/router.ts` with hash history
- [x] Mount `<RouterProvider>` in `App.tsx`
- [x] Add TanStack router plugin to `vite.renderer.config.ts`
- **Files**: `package.json`, `src/renderer/router.ts`, `src/renderer/routes/__root.tsx`, `src/renderer/routes/index.tsx`, `src/renderer/routes/settings.tsx`, `src/renderer/App.tsx`, `vite.renderer.config.ts`, `tsr.config.json`, `src/renderer/routeTree.gen.ts`
- **Commit message**: `feat: add tanstack router with home and settings pages`
- **Bisect note**: Router + pages + provider must all be added together for the app to render
- **Implementation notes**: Installed `@tanstack/react-router`, `@tanstack/router-vite-plugin`, and `@tanstack/router-cli` (dev). Created `tsr.config.json` at project root to configure route generation paths (routesDirectory and generatedRouteTree) since the CLI doesn't accept these as flags. Root layout uses a sidebar nav with Links. Router uses `createHashHistory` for Electron `file://` compatibility. App.tsx replaced Phase 2's placeholder with `RouterProvider`. The `routeTree.gen.ts` file is auto-generated by the TanStack Router plugin/CLI.
- **Validation results**: `pnpm exec tsc --noEmit` passes (exit 0). `pnpm run make` passes (exit 0, artifacts in `out/make/`). `pnpm start` and router navigation require manual verification.
- **Review**: Approved - Hash history correctly configured for Electron file:// protocol. Root layout with sidebar nav, two pages with Links. Route tree auto-generated. RouterProvider properly mounted in App.tsx.

### ✅ Phase 4: Set up electron-trpc IPC layer

- **Step**: 3
- **Complexity**: 3
- [x] Install `electron-trpc`, `@trpc/server`, `@trpc/client`, `@trpc/react-query`, `@tanstack/react-query`, `zod`
- [x] Create tRPC router in `src/main/trpc/router.ts` with a sample `hello` procedure
- [x] Create tRPC context and procedure helpers in `src/main/trpc/trpc.ts`
- [x] Update `src/preload.ts` to call `exposeElectronTRPC()`
- [x] Call `createIPCHandler` in `src/main.ts` after window creation
- [x] Create tRPC client in `src/renderer/trpc.ts` using `ipcLink`
- [x] Wrap React app with `QueryClientProvider` and tRPC provider
- [x] Add a sample query call in one of the pages to verify IPC works
- **Files**: `package.json`, `src/main/trpc/trpc.ts`, `src/main/trpc/router.ts`, `src/main.ts`, `src/preload.ts`, `src/renderer/trpc.ts`, `src/renderer/App.tsx`, `src/renderer/routes/index.tsx`
- **Commit message**: `feat: add electron-trpc IPC layer with sample procedure`
- **Bisect note**: Preload, main handler, and renderer client must all be wired together in one phase
- **Implementation notes**: Installed electron-trpc 0.7.1, @trpc/server 11.10.0, @trpc/client 11.10.0, @trpc/react-query 11.10.0, @tanstack/react-query 5.90.21, zod 4.3.6. Added `sandbox: false` to BrowserWindow webPreferences (required by electron-trpc's preload script which uses Node APIs). The `hello` procedure accepts an optional `name` string and returns a greeting. Home page displays the greeting from the IPC query. Preload uses `process.once("loaded", ...)` pattern per electron-trpc docs.
- **Validation results**: `pnpm exec tsc --noEmit` passes (exit 0). `pnpm run make` passes (exit 0, artifacts in `out/make/`). `pnpm start` and IPC verification require manual check.
- **Review**: Approved - Clean electron-trpc setup with proper wiring across main, preload, and renderer. Sample hello procedure with zod validation, ipcLink client, and QueryClientProvider wrapping. All automated completion conditions pass.

### ✅ Phase 5: Set up SQLite with better-sqlite3

- **Step**: 4
- **Complexity**: 3
- [x] Install `better-sqlite3` and `@types/better-sqlite3`
- [x] Create `src/main/db/database.ts` — initializes DB file in app's userData path, creates connection
- [x] Create `src/main/db/migrations.ts` — simple migration runner with a `migrations` version table
- [x] Add a sample `settings` table (key-value store) as the first migration
- [x] Expose DB operations via tRPC procedures: `settings.get`, `settings.set`, `settings.list`
- [x] Add `better-sqlite3` to Vite's external modules in `vite.main.config.ts`
- [x] Wire up a settings read/write in the Settings page to verify end-to-end
- **Files**: `package.json`, `src/main/db/database.ts`, `src/main/db/migrations.ts`, `src/main/trpc/router.ts`, `vite.main.config.ts`, `src/renderer/routes/settings.tsx`
- **Commit message**: `feat: add sqlite database with settings table and trpc integration`
- **Bisect note**: DB init, migration, trpc procedures, and vite externals must be configured together
- **Implementation notes**: Installed better-sqlite3 12.6.2 and @types/better-sqlite3 7.6.13. Database file stored at `app.getPath("userData")/productdevr.db` with WAL journal mode. Migration runner uses a `migrations` table to track applied versions. Settings table is a simple key-value store with UPSERT for `settings.set`. Added `closeDatabase()` call on `before-quit` in main.ts. Settings page has a form to add key-value pairs and displays all stored settings. Added `better-sqlite3` to rollupOptions.external in vite.main.config.ts.
- **Validation results**: `pnpm exec tsc --noEmit` passes (exit 0). `pnpm run make` passes (exit 0, artifacts in `out/make/`). `pnpm start` and end-to-end settings verification require manual check.

## Phase Status Legend

| Emoji | Status      |
| ----- | ----------- |
| ⬜    | Not started |
| 🔄    | In progress |
| ✅    | Completed   |

## Current Status

- **Current Phase**: All phases complete
- **Progress**: 5/5
