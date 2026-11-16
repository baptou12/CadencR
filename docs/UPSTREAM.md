# Upstream policy

## Purpose

This fork tracks upstream Cadencr (`merkr-software/CadencR`) as closely as possible while maintaining a small, intentional layer of our own changes.

Our branch, `ours`, is the current upstream `main` plus a maintained stack of fork patches.

These patches are living changes. They may be rewritten, squashed, split, replaced, contributed upstream or removed as the project evolves. Preserving their original commits is less important than preserving their intent when that intent still matters.

We synchronize daily and reconsider the entire patch stack at every upstream release.

## Branches and remotes

| Ref | Role | Rule |
|---|---|---|
| `origin` | Upstream `merkr-software/CadencR` | Fetch only |
| `fork` | Our repository `baptou12/CadencR` | Push target |
| `main` | Mirror of `origin/main` | Fast-forward only; no fork changes |
| `ours` | Upstream plus our active patch stack | Linear history; controlled rewriting allowed |
| `feature/*`, `fix/*` | Proposed fork changes | Start from `ours`; reviewed through PRs |
| `sync/*` | Temporary synchronization candidate | Rebase and validate before updating `ours` |

Upstream changes enter `ours` through rebase. Do not merge upstream into `ours` or introduce merge commits into the fork patch stack.

If upstream rewrites its own history, stop the normal synchronization procedure and review the new base explicitly.

## The patch stack

Each fork change must have a clear purpose and be independently understandable.

- Keep one logical change per patch, or a small, explicitly related patch series.
- Keep changes focused; separate unrelated cleanup and formatting.
- Prefer upstream extension points and isolated additions when they reduce maintenance.
- Modify upstream code directly when that produces a simpler, smaller change.
- Avoid unnecessary abstractions, feature flags and permanent compatibility layers.
- Record dependencies between patches when they cannot stand alone.

The goal is the smallest maintainable difference from upstream that delivers our desired behavior.

No patch owns an upstream area permanently. Every patch must remain open to reconsideration.

## Patch register

Maintain a short register in `docs/fork-patches.md`.

Each active change has a stable identifier, independent of its commit hashes.

| Field | Required information |
|---|---|
| ID | Stable identifier, such as `FORK-001` |
| Purpose | Behavior we need and why |
| Scope | Main files or components affected |
| Dependencies | Other fork patches it requires, if any |
| Validation | How to verify the intended behavior |
| Retirement condition | What would make the patch unnecessary |
| Last review | Upstream release or commit reviewed against |

Reference the identifier in the relevant commit messages.

The register describes the current stack. Git history and synchronization reports preserve earlier decisions.

## New changes

Before adding a patch, check whether upstream already provides the behavior or offers a suitable extension point.

General bug fixes and broadly useful improvements should be proposed upstream when practical. They may be carried locally while awaiting adoption.

Fork-specific changes are welcome when their benefit justifies their maintenance cost.

Every PR must explain:

- The intended behavior.
- Why a local difference is currently necessary.
- How it was validated.
- When it could be removed or replaced.

Accepted changes enter `ours` as focused commits. Squash or reorganize them when that makes future rebases easier.

## Daily synchronization

A daily agent prepares and validates a rebase onto the latest upstream `main`.

For each run:

1. Fetch both remotes and record the exact upstream base and published `ours` tip.
2. Preserve the previous `ours` tip in a recoverable remote reference.
3. Create a synchronization candidate in an isolated worktree.
4. Rebase the fork stack from its recorded old base onto the fetched upstream commit.
5. Resolve conflicts using the patch’s documented intent and the new upstream implementation.
6. Regenerate derived files using repository tooling.
7. Compare the old and new patch stacks with `git range-diff`; inspect the resulting diff against upstream.
8. Run the repository’s required checks and the validation relevant to affected patches.
9. Publish only after validation succeeds.

A clean rebase alone is not sufficient: upstream may change behavior without causing a textual conflict.

The agent may adapt implementation details to preserve documented behavior. Product decisions, unclear intent and significant behavioral changes require maintainer review.

On failure or uncertainty, keep the published `ours` unchanged and report the blocker with the prepared candidate.

## Publishing a synchronization

Normal development goes through PRs. The synchronization agent has a narrowly scoped exception to rewrite `ours` after successful validation.

- Serialize synchronization runs.
- Publish with an explicit lease against the `ours` tip recorded at the start.
- Never use an unconditional force push.
- If `ours` changed meanwhile, rebuild and revalidate the candidate.
- Keep a recoverable reference to the previous published stack.
- Ensure CI runs on synchronization candidates and on PRs targeting `ours`.

Branch protection must permit this controlled update by the synchronization identity.

Every successful synchronization records the old and new upstream bases, old and new fork tips, patch adaptations or removals, and validation results.

## Conflict resolution

Resolve conflicts by intent, not by preserving old lines.

For each affected patch:

1. Understand the upstream change.
2. Check whether upstream now satisfies our requirement.
3. Remove the patch if it is redundant.
4. Otherwise, implement its remaining intent using the current upstream design.
5. Update its validation and register entry.

Do not apply blanket “ours” or “theirs” resolutions. Repeated conflicts are a reason to simplify, redesign or upstream a patch.

## Review at every upstream release

Daily rebases keep the fork current. Release reviews decide which differences are still worth carrying.

Review every active patch, including those that rebased without conflicts.

| Decision | Action |
|---|---|
| Keep | The requirement and implementation still fit |
| Adapt | Preserve the requirement using the new upstream design |
| Replace | Use an upstream capability or a smaller local patch |
| Upstream | Propose the generalizable change upstream |
| Drop | Remove an obsolete, redundant or unjustified change |

Read release notes and relevant code changes, assess dependencies between patches, and exercise the affected application flows.

The review may reorder, squash, split or rewrite the stack. Update the register and record a decision for every active patch.

The maintainer arbitrates changes to intended behavior. The agent prepares the analysis and implementation.

## Shared development and releases

`ours` is a moving integration branch whose commit hashes may change after synchronization.

Work in progress must be transplanted onto the refreshed stack without reintroducing its previous versions. Use the saved old tip to identify only the feature’s own commits.

Published fork releases use immutable tags identifying the exact validated source. Never move a release tag when rebasing `ours`.

Database and persistent-data compatibility must survive history rewriting: removing a source patch does not undo migrations or data already deployed. Follow the repository’s migration-safety rules.

## Guiding principle

Follow upstream continuously. Carry only useful differences. Preserve intent while it matters, and remove the patch when it no longer does.
