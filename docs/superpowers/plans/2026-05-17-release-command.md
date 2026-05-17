# Release Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared `/release vX.Y.Z` workflow that guides agents through changelog, marketing news, security review, version bumps, local tagging, tag push, and GitHub asset polling.

**Architecture:** Put the reusable release workflow in `.agents/skills/release/SKILL.md` so Codex and OpenCode can discover it through shared project skills. Add Claude symlinks only where they provide native slash-command/skill discovery. Put automated preflight checks and local annotated tag creation in `scripts/release.sh`; leave tag pushing to the agent.

**Tech Stack:** Markdown agent skill/command files, Bash, GitHub CLI, trufflehog, git.

---

### Task 1: Shared release workflow

**Files:**
- Create: `.agents/skills/release/SKILL.md`

- [x] Create an English release workflow with required argument `vX.Y.Z`.
- [x] Require the agent to ask the developer for marketing/news copy before writing the landing news post.
- [x] Require a dedicated security/regression review agent when subagents are available.
- [x] Require checking the latest `origin/main` CI status instead of rerunning local tests.
- [x] Require `scripts/release.sh vX.Y.Z` before pushing.
- [x] Require the agent, not the script, to run `git push origin vX.Y.Z`.
- [x] Require polling GitHub release assets after pushing.

### Task 2: Automated release preflight script

**Files:**
- Create: `scripts/release.sh`
- Create: `scripts/release-notes.sh`
- Modify: `.github/workflows/desktop-release.yml`

- [x] Validate `vX.Y.Z` argument.
- [x] Verify clean worktree.
- [x] Find latest previous `v*` tag and commit hash.
- [x] Verify local tag, remote tag, and GitHub release are not already occupied.
- [x] Verify `CHANGELOG.md`, landing news, and version files are updated.
- [x] Extract the matching changelog section into GitHub release notes.
- [x] Publish the GitHub release with `--notes-file` from the extracted changelog section.
- [x] Run trufflehog from previous release commit.
- [x] Create local annotated tag only after all checks pass.

### Task 3: Provider compatibility links

**Files:**
- Create symlink: `.claude/commands/release.md`
- Create symlink: `.claude/skills/release`

- [x] Link Claude slash command to the shared release skill.
- [x] Link Claude skill discovery to the shared release skill directory.
- [x] Do not create `.opencode/commands/release.md` because OpenCode already reads shared/Claude project command sources in this repo context.

### Task 4: Verification

**Files:**
- Verify all created files and symlinks.

- [x] Run Bash syntax check for `scripts/release.sh`.
- [x] Check line counts stay below repository limits.
- [x] Inspect git diff.
