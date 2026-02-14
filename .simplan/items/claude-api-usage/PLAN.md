# Plan: Claude API Usage

## Context
ProductDevR is an Electron app with a tRPC IPC layer between main and renderer. The sidebar (`src/renderer/components/Sidebar.tsx`) has a header with "ProductDevR" text and a Settings gear icon. The usage component will go inline, left of the Settings icon.

Anthropic exposes an undocumented OAuth usage endpoint at `https://api.anthropic.com/api/oauth/usage` that returns:
```json
{
  "five_hour": { "utilization": 6.0, "resets_at": "2025-11-04T04:59:59Z" },
  "seven_day": { "utilization": 35.0, "resets_at": "2025-11-06T03:59:59Z" }
}
```

Authentication uses an OAuth token stored in macOS Keychain under `"Claude Code-credentials"` (JSON with `claudeAiOauth.accessToken`), retrieved via `security find-generic-password -s "Claude Code-credentials" -w`.

## Clarifications
- **Data source**: OAuth usage API endpoint with token from macOS Keychain
- **Placement**: Inline, left of the Settings gear icon in the sidebar header
- **Visual format**: Compact text only (e.g., `5h: 42% · Wk: 15% · ↻2h 31m`)
- **Poll interval**: Every 3 minutes
- **Auth**: Read from macOS Keychain in main process

## Completion Conditions

| Condition | Validation Command | Expected Outcome |
|-----------|-------------------|------------------|
| Linting passes | `pnpm run lint` | Exit code 0 |
| Type check passes | `npx tsc --noEmit` | Exit code 0, no errors |

## Execution Steps

| Step | Phases | Description |
|------|--------|-------------|
| 1    | 1      | Backend: Keychain reader + usage API fetcher in main process |
| 2    | 2      | tRPC endpoint to expose usage data to renderer |
| 3    | 3      | React hook + UI component in sidebar |

> **Parallelism**: Each step depends on the previous one.

## Phases

### ⬜ Phase 1: Usage API service in main process
- **Step**: 1
- **Complexity**: 3
- [ ] Create `src/main/usage/usage-service.ts` with:
  - Function to read OAuth token from macOS Keychain via `child_process.execSync('security find-generic-password -s "Claude Code-credentials" -w')`
  - Parse the JSON to extract `claudeAiOauth.accessToken`
  - Function to call `https://api.anthropic.com/api/oauth/usage` with Bearer token and `anthropic-beta: oauth-2025-04-20` header
  - Return typed response: `{ five_hour: { utilization: number; resets_at: string | null }; seven_day: { utilization: number; resets_at: string | null } }`
  - Cache result in-memory with 3-minute TTL to avoid redundant calls
  - Graceful error handling (return null if Keychain unavailable or API fails)
- **Files**: `src/main/usage/usage-service.ts`
- **Commit message**: `feat: add Claude usage API service with Keychain auth`
- **Bisect note**: Self-contained module with no callers yet, safe standalone

### ⬜ Phase 2: tRPC endpoint for usage data
- **Step**: 2
- **Complexity**: 2
- [ ] Create `src/main/trpc/usage.ts` with a `usageRouter` containing a `getUsage` query that calls the usage service
- [ ] Register `usage: usageRouter` in `appRouter` in `src/main/trpc/router.ts`
- **Files**: `src/main/trpc/usage.ts`, `src/main/trpc/router.ts`
- **Commit message**: `feat: add tRPC usage router for Claude API usage data`
- **Bisect note**: New router added to appRouter; no existing code affected

### ⬜ Phase 3: Usage display component in sidebar
- **Step**: 3
- **Complexity**: 3
- [ ] Create `src/renderer/components/UsageIndicator.tsx`:
  - Call `trpc.usage.getUsage.useQuery()` with 3-minute `refetchInterval`
  - Format as compact text: `5h: X% · Wk: Y%` with time-until-reset on hover (tooltip)
  - Color coding: green (<60%), yellow (60-85%), red (>85%) via Tailwind text colors
  - Show `--` placeholder while loading or on error
- [ ] Add `<UsageIndicator />` in `Sidebar.tsx` header, between the title span and the Settings Link
- **Files**: `src/renderer/components/UsageIndicator.tsx`, `src/renderer/components/Sidebar.tsx`
- **Commit message**: `feat: add usage indicator component to sidebar header`
- **Bisect note**: N/A

## Phase Status Legend

| Emoji | Status |
|-------|--------|
| ⬜ | Not started |
| 🔄 | In progress |
| ✅ | Completed |

## Current Status
- **Current Phase**: Not started
- **Progress**: 0/3
