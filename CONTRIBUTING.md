# Contributing to Cadencr

Thanks for your interest in improving Cadencr! This guide covers coding conventions, commit style, and the pull request process.

By participating, you agree to the [Code of Conduct](./.github/CODE_OF_CONDUCT.md). Security issues follow a separate private flow — see [SECURITY.md](./.github/SECURITY.md).

---

## Local Development

Setup (prerequisites, `.env` files, `pnpm dev`) lives in the [README — Build from source](./README.md#build-from-source). Follow that first. The notes below assume your dev environment is running.

## Common Commands

```bash
pnpm dev             # run desktop app + backend service (the usual)
pnpm start           # desktop only (skips the service watcher)
pnpm test            # run all tests (vitest + cargo test)
pnpm run lint        # oxlint + cargo check
pnpm run format      # auto-format (oxfmt + rustfmt)
pnpm run format:check
```

Run a task for a single package:

```bash
pnpm --filter @cadencr/desktop <script>
pnpm --filter @cadencr/service <script>
```

---

## Project Conventions

The full ruleset for code style, file/function size limits, and architectural boundaries lives in [`.claude/rules/`](./.claude/rules/) and is mirrored into [`AGENTS.md`](./AGENTS.md) / [`CLAUDE.md`](./CLAUDE.md). Read those before opening a PR.

The three rules contributors hit most often:

- Use **pnpm**, not `npm` or `yarn`.
- **Do not run `pnpm orval`.** `packages/tauri/src/api/generated/index.ts` is hand-maintained; add new endpoints manually following the existing patterns.
- Keep files under **400 lines** and functions under **100 lines**; extract modules before crossing those limits.

---

## Branching

- **`main`** is the integration branch.
- Work on short-lived feature branches named with a scope prefix and a short slug — for example `feat/desktop-sidebar-redesign`, `fix/session-runtime-status`, `chore/bump-tauri`.
- Rebase onto the latest `main` before opening a pull request.

## Commit Convention

Commits follow **[Conventional Commits](https://www.conventionalcommits.org/)**:

```
<type>(<scope>): <short imperative summary>
```

- **Types**: `feat`, `fix`, `refactor`, `chore`, `docs`, `style`, `test`, `perf`, `build`.
- **Scopes** (optional): package or area — `desktop`, `service`, `session`, `providers`, `landing`, `agent`, etc.
- One logical change per commit. Explain **why**, not just **what**, in the body when the diff is non-obvious.
- Husky runs `pnpm turbo run format:check lint ts-check test knip` as a pre-commit hook. Do not bypass it (`--no-verify`) unless a maintainer asks.

Run `git log --oneline` in this repo for a large set of real examples.

## Pull Request Process

1. **Open early.** Draft PRs are welcome for feedback before the work is final.
2. **Use the PR template.** It prompts for summary, motivation, and a test plan.
3. **Keep PRs focused.** A PR should be reviewable in one sitting. Split large changes.
4. **CI must be green** — lint, typecheck, tests, knip, and format checks all pass.
5. **Squash on merge.** PRs are squash-merged so `main` stays linear; the squash commit message must itself follow Conventional Commits.

For a bugfix, include a test that fails without the fix. For a feature, include a test that exercises the new behavior end-to-end when practical.

---

## Notes

- `.env` files under `packages/*/` are local-only and must never be committed. They are covered by `.gitignore`.
- Questions? Open a [discussion](https://github.com/rle-mino/cadencr/discussions) or a draft issue.
