# Upstream policy

How this fork stays mergeable with upstream Cadencr (`merkr-software/CadencR`)
while keeping its own philosophy. Draft v0, written 2026-10-14. Branch name and
hosting are decided; the rest is to validate before it is condensed into
`.claude/rules/upstream.md`.

**TL;DR**

- `main` is a read-only mirror of upstream. Our master is `ours`. Every change
  lands there through a pull request.
- We merge upstream at every release tag. Merging must always be possible:
  conflicts are resolved by the deviation class recorded in the ledger below,
  never by picking lines from memory.
- Anything upstream would accept goes upstream first. The fork only carries what
  encodes our philosophy, and each such deviation is additive, switchable,
  marked and listed.

## Branches and remotes

| Ref | Role | Rule |
|---|---|---|
| `origin` | upstream `merkr-software/CadencR` | fetch only |
| `fork` | `baptou12/CadencR` | our push target; PRs live here |
| `main` | mirror of `origin/main` | fast-forward only, never commit on it |
| `ours` | our master | protected; receives PRs only |
| `sync/vX.Y.Z` | one upstream merge | from `ours`, merges tag `vX.Y.Z`, PR to `ours` |
| `feature/*`, `fix/*` | work | from `ours`, PR to `ours` |

`fork/main` is a pure mirror of `origin/main`; only ever fast-forward it.
`ours` is also git's word for our side of a merge: on `ours`, `--ours` is us
and `--theirs` is upstream. CI runs on every pull request whatever its target,
so PRs to `ours` are checked; pushes to `ours` itself do not trigger CI
(`ci.yml` lists only `main` and `v*`). In the PR template, read `main` as
`ours`.

## Two lanes

Before writing code, decide which lane the change belongs to.

| Lane | Test | Where it lands |
|---|---|---|
| Upstream first | A bug fix, or an improvement upstream has no reason to refuse | PR to `origin`; reaches us at the next sync (`cherry-pick -x` if urgent) |
| Fork only | Encodes our philosophy, or upstream declined it | PR to `ours`, with a ledger entry |

The smaller the fork-only lane, the cheaper every sync. When in doubt, try
upstream first.

## Deviation classes

Every area of the codebase is in exactly one class. The class decides who wins
at merge time.

| Class | Meaning | At conflict |
|---|---|---|
| FOLLOW | We do not touch it (default for everything) | Take upstream. There should be no conflict. |
| EXTEND | We add next to upstream code: new files, new registry entries, new rule files | Take upstream, re-attach our additions. |
| ADAPT | We changed upstream code in place | Take upstream, then re-apply our intent (not our old lines), guided by the marker and the ledger entry. |
| OWN | We replaced it; upstream's version is irrelevant (branding, defaults, a UX flow) | Keep ours, then read upstream's diff for the area and port what fits our philosophy. |
| OFF | Upstream feature we do not want | Disabled behind one switch, never deleted. Take upstream, keep the switch off. |
| Derived | Generated and lock files | Never hand-resolve: regenerate (`generate:api`, routeTree, `build:agents-md`, `pnpm install`, `pnpm rust -- build`). |

## Rules for any fork-only change

1. Additive first: new file > new function > in-place edit. Never delete
   upstream code; use OFF.
2. One switch per deviation: a single place to flip or remove it (flag, registry
   entry, settings key, descriptor file).
3. Mark every in-place edit of upstream code with `// FORK: <why>` (`-- FORK:`
   in SQL, `<!-- FORK: -->` in docs) so a conflict hunk tells which side is ours.
4. Record it: a deviation without a ledger entry is a bug. The PR that
   introduces it updates the ledger.
5. In shared lists upstream keeps growing (`BUILTIN_PROVIDERS`, settings
   allowlist keys, the `openapi.rs` lists), our entries come last under a
   `// FORK` comment so hunks stay separate.
6. Our agent rules live in their own files under `.claude/rules/`, followed by
   `pnpm build:agents-md`. Never edit `CLAUDE.md` or an upstream rule file in
   place.
7. Migrations are additive only; never edit an upstream migration. Follow the
   `migration-safety` skill.
8. Never touch derived files by hand (see the class table).
9. An ADAPT that conflicts at two consecutive syncs is reconsidered: move it to
   EXTEND or OWN, or propose it upstream.
10. All repository rules (`CLAUDE.md`, `.claude/rules/*.md`, definition of done)
    stay in force on the fork.

## Sync procedure (every upstream release tag)

1. `git fetch origin --tags`, then fast-forward `main`.
2. `git switch -c sync/vX.Y.Z ours && git merge vX.Y.Z` (a real merge:
   no squash, no rebase).
3. Resolve each conflict by its class. Regenerate derived files last.
4. Triage upstream news: `git log --oneline vPREV..vX.Y.Z` plus the release
   notes. For each new feature decide FOLLOW, ADAPT or OFF and update the ledger.
5. Checks: `pnpm --filter @cadencr/desktop ts-check`, `pnpm lint`, `pnpm test`,
   `pnpm --filter @cadencr/desktop knip`, `pnpm build:agents-md --check`,
   `CADENCR_PRECOMMIT_FULL=1 node scripts/pre-commit.mjs`.
6. Run the app (`pnpm dev`) and exercise every OWN and ADAPT area (the `qa`
   skill).
7. PR `sync/vX.Y.Z` to `ours` with the triage table in the description.
   Merge, do not squash, so the next merge base is the tag.

Between tags, an urgent upstream fix is `git cherry-pick -x <sha>`; the `-x`
trailer keeps the later tag merge clean.

## Deviation ledger

| Area | Class | Why | Files | Since |
|---|---|---|---|---|
| Upstream policy | EXTEND | This document | `docs/UPSTREAM.md` | v0.13.0 |

## Our philosophy (to fill)

The triage in step 4 and every OWN or ADAPT decision need a written reference.
Answer these in a few lines each:

- What do we optimize Cadencr for that upstream does not? Workflows, team
  orchestration, MCP tooling, locale, hosting.
- Which upstream directions would we refuse, and which do we always follow
  (security patches, provider SDKs, dependency bumps)?
- Who arbitrates a class change (FOLLOW to ADAPT, ADAPT to OWN)?
- Do we ship our own builds (release pipeline, branding) or always run from
  source?

Local branches already hint at candidates to classify at the first triage: MCP
write gating and audit journal, steward grants, schedules tools, project
update and stop tools, worktree-mode gates.

## Bootstrap (first session)

- [x] 1. Master branch named `ours`, hosted on GitHub `baptou12/CadencR`.
- [x] 2. Create `ours` from `origin/main`, push it to `fork`, protect it on GitHub.
- [x] 3. Fast-forward the mirror: `git push fork origin/main:main`.
- [x] 4. First PR to `ours`: this document only, zero upstream files touched.
- [ ] 5. Fill "Our philosophy"; classify the candidates above.
- [ ] 6. Condense rules 1 to 10 into `.claude/rules/upstream.md`, run `pnpm build:agents-md`.
- [x] 7. First real sync at the next upstream tag, to rehearse the procedure.
