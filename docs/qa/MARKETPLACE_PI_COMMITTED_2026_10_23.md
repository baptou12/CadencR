# Pi exact committed candidate — 2026-10-23

## Scope and result

The exact committed Pi candidate passed native ACP loopback QA on macOS arm64.
This is a local candidate/protocol check, **not managed-install qualification or
production-publication approval**. No personal credentials or paid API were used.

Preparation captured the actual HEAD below after a documentation commit advanced
it beyond `63f38032311559633096ccfe15c2b3c896f68937`. The preparer verified that
its source commit equalled HEAD and that the Pi source subtree was clean.

## Exact identities

| Binding                        | Value                                                              |
| ------------------------------ | ------------------------------------------------------------------ |
| Source commit                  | `758c4be381020f0a9839c273ed6c71688bb20c1b`                         |
| Pi subtree Git tree            | `17bbf1c37877aedebb886a8e6cdb1099dbd4a7b0`                         |
| Connector / external Pi / Node | `0.4.0` / `0.85.1` / `22.19.0`                                     |
| Target / runtime               | `darwin-aarch64` / `external-node-pi`, not bundled                 |
| CLI                            | Local source CLI `0.14.0`, not a released-CLI qualification        |
| CLI SHA-256                    | `5193ba49d62410b29cb04773e05817015241980f8d1bdb11ef876b398bdd1555` |
| Archive                        | `pi-0.4.0-darwin-aarch64.tar.gz`, `25627` bytes                    |
| Archive SHA-256                | `be0d067a22c4c341bd6348af84c8c3df1df74df63148441a86f6e7000457da48` |
| Final metadata SHA-256         | `59a33773ac9a7510acc2718b00ce5a97a74c5217ff3f7f532c576a2813fb8374` |
| Input metadata SHA-256         | `82c240bbb901668fd6aba66102063f8bd1b9d630f3d7fab1e7b6064006e844ea` |
| Candidate receipt SHA-256      | `9251c355779d67fb9b5bda21a83460db47e84f640aaa0c6146f6f59bc00c1ac9` |

Metadata deliberately uses publisher `qa-placeholder-not-production`, minimum app
version `0.14.1` (a QA input, not a compatibility certification), and an
`example.invalid` archive URL. Neither publisher nor URL is production metadata.
The receipt retains `authority: candidate`, `qualification: PENDING`, and
`publication: PENDING`.

## Procedure and observations

1. Ran `plugins/providers/pi/scripts/prepare-candidate.mjs` with explicit source
   commit, target, runtime, metadata and pinned CLI checksum.
2. Canonical CLI packing and the preparer's second reproducibility packing
   produced identical archive bytes. The archive also matches the earlier durable
   working-tree evidence, now bound to the committed source above.
3. Extracted that archive into fresh private scratch; passed its `bin/provider`
   and the installed Pi executable to `test/native-loopback.test.mjs`.
4. Ran all Pi source test files separately with native opt-in absent.

| Check                                         | Result                                                       |
| --------------------------------------------- | ------------------------------------------------------------ |
| Native opt-in test suite                      | `2` passed, `0` failed, `0` skipped                          |
| Discovery / initialize / new session          | Passed                                                       |
| Streamed text / `end_turn` / usage            | Passed                                                       |
| Durable connector restart and resumed context | Passed                                                       |
| Held-stream cancellation                      | Passed                                                       |
| Model accounting                              | Exactly `3` owned loopback fixture requests                  |
| Partial/nonabsolute native opt-in rejection   | Passed                                                       |
| Source suite                                  | `92` passed, `0` failed, `2` intentional native opt-in skips |

The restricted sandbox initially refused loopback listeners with `EPERM`; the
same tests passed after permission to bind the owned loopback fixture was granted.
This was an environment restriction, not a connector assertion failure.
Private evidence files are `preparation.log`, `native-loopback-permitted.log`,
`source-tests-permitted.log`, the receipt and metadata. Local paths and raw
session data are intentionally omitted here.

## Safety and qualification boundary

The existing native harness supplies isolated HOME/config/workspace/session
storage and an allowlisted environment, routes scripted model traffic to
`127.0.0.1`, and closes its owned fixture and children. This is not OS-enforced
network isolation or proof of real-model authentication/tool behavior.
No database, production service, signing key, feed or release was modified.
No new service was started during this check.

The earlier [generic-host QA](./MARKETPLACE_PI_LOOPBACK_2026_10_18.md) used an
isolated service/database and a **local descriptor**. It demonstrates a useful
repeatable host protocol approach, but does not test this candidate's managed
admission or signed-feed install path. That prior service test was not rerun here.

## Managed-install feasibility: next isolated wave

A managed check is technically feasible using a fresh isolated service, retained
QA database, settings/HOME, workspace and ports, plus owned test signing/feed
fixtures. It must exercise the actual managed catalog/blocklist verification,
archive download/digest validation, admission, activation/descriptor projection,
and launch path—not copy the prior local-descriptor registration.

Before starting, prepare a trusted QA-only feed context and usable archive URL;
`example.invalid` cannot support install. Preserve all production trust/pins and
never reinterpret QA placeholder metadata as publisher approval. The installed
external Node/Pi prerequisites must be explicit; successful archive installation
alone cannot qualify an external runtime. Then repeat loopback streaming,
cancellation and restart/resume through the managed provider, and separately test
update/failure recovery. This wave did not attempt those steps.

Remaining gates include managed install/update/recovery, exact-candidate generic
host conformance, external auth/model/tool behavior, x86_64, legal/source review
and production authority. No readiness policy or Pi source was changed here.
