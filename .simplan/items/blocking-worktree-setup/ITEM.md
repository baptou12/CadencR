# Blocking worktree setup before agent start
- **Type**: 🐛 Fix
- **Status**: ✅ DONE
- **Description**: Make git worktree creation a blocking step before plan/brainstorm agents start. Currently `startPlan`/`startBrainstorm` fire-and-forget `setupWorktreeForFeature()` AFTER the agent starts, so `resolveAgentCwd()` falls back to `project.path` and agents run on the main branch instead of an isolated worktree. The worktree must be created (but setup commands can run in background) before the agent subprocess is spawned.
