# Marketplace consumer QA against the production feeds — 2026-10-26

Scope: the first consumer lifecycle against the **production** signed catalog and
revocation policies on `merkr-software/cadencr-registry@marketplace-v2`, from a
development build of `feature/marketplace-activation` (marketplace gate removed),
with the production trust (`cadencr-root-1`, generation 1, online key
`cadencr-registry-1`) and the five feed URLs compiled in through
`scripts/validate-marketplace-build-env.mjs`. Fresh database and data root under
`/private/tmp/mkt-qa`; real Electron renderer driven over CDP.

Platform: **macOS arm64 only** (macOS 27, dev Electron + debug service). No Linux
client, no Intel Mac, no packaged-app evidence in this record.

## Results

| Step | Result |
| --- | --- |
| Startup trust and policy | Service verified the provider blocklist with `cadencr-registry-1` at startup. |
| Discover | 4 packages from the signed catalog (`18a2cf06…`), "catalog published 11 hours ago", Themes 3 / Providers 1, Pi listed for 4 platforms. |
| Theme install (API and UI) | Graphite installed through `POST /api/themes/managed`; Ember installed from its detail page ("Install 0.1.0"), archive verified. |
| Theme activation | "Use this theme" applied Ember: `--background` `#131416` → `#251b19`, "apply confirmed by Cadencr". |
| Theme removal | Graphite removed through the confirmation dialog; its revision directory was deleted, Ember untouched. |
| Restart persistence | After a service restart and renderer reload Ember stayed active and the Installed count was kept. |
| Pi 0.4.0 install | **Failed closed**: quarantined at the conformance gate, `MANAGED_RESTORE_FAILED` — `session/resume` across a fresh process of a never-prompted session (`No session found`). |
| Fix and later version | Pi 0.4.1 resumes with `pi --session-id` (exact id, created if missing). Qualified on four targets (run `40379170907` + local darwin-aarch64), author release `plugins/provider-pi/v0.4.1` (run `40386012609`), registry PR #18, catalog publication run `40405778470`: new catalog `2056f6a1…` (5 entries, Pi 0.4.0 and 0.4.1), verified with the `0.15.2` CLI. |
| Pi 0.4.1 install | Passed the conformance gate; after restart: registered, enabled, not quarantined, 8 models in the composer picker. |
| Real Pi turn | Project in a temp repo, worktree session, `openai-codex/gpt-5.6-sol`: reply `PINEAPPLE`. `gpt-5.4-mini` and `gpt-5.5` are refused upstream for a ChatGPT-account Codex login (`SDK_ERROR` surfaced in the turn); the respawn after the model change resumed without error. |
| Resume after restart | Service restarted; follow-up "what word did you reply with" answered `pineapple` (history kept). |
| Pi removal | "Remove Pi…" retired the descriptor; history shows "Removed 0.4.1"; restart required to drop it, as the dialog states. |

## Registry checks on production

- A PR changing an existing version's archive digest (PR #17, closed unmerged)
  failed contribution CI: `packages/graphite-0.1.0.json: existing packages are immutable`.
- The incremental publication added Pi 0.4.1 next to 0.4.0 with a new 13-day window.

## Not covered here

- Packaged clients (macOS DMG, Linux AppImage/deb), Intel Mac, Linux desktop.
- Custom tabs: no tab is in the production catalog (no official tab in v1).
- Revoked/expired/tampered feeds on the production path (covered by automated
  tests and earlier QA-target runs only).
- A third-party publisher's submission.
