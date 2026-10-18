# Marketplace waves 1–2 — source qualification

## Scope

- Uncommitted source implementation, not a distributed CLI or public deployment.
- Official preparation covers providers, themes and compiled custom tabs. The
  initial publication candidates remain Graphite, Ember, Fjord and Pi; no official
  tab source or publication approval was invented.
- Marketplace visibility, production trust/pins and GitHub protections are unchanged.

## Source checks

| Check                                   | Result and boundary                                                                                                                                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final Rust workspace                    | 4,478 passed; one pre-existing ignored test; doctests passed; failure scan clean                                                                                                                                                 |
| Final lint/format                       | Official `pnpm lint`, Rust formatting, scoped script/plugin lint and changed-document formatting passed                                                                                                                          |
| Managed custom-tab tests                | 98 passed, including 40 updates, historical incompatibility, owner-local concurrency, leases, interruption, unknown files, links and database preservation                                                                       |
| Official release/author/isolation tests | 52 passed with the actual local Rust CLI; six original acceptance/rejection cases cover all three kinds. Synthetic Git-source fixtures and a separate real shallow-tag-binding test are not production publication qualification |
| Repository script suite                 | 262 passed after strict-JSON and bounded Git-batch fixes                                                                                                                                                                         |
| Pi/theme suite                          | 93 passed; two explicit opt-in skips; eight theme checks and 120 contrast assertions passed                                                                                                                                      |
| Fresh extracted Pi runtime              | Two native-loopback tests passed with actual Pi `0.85.1`; streaming/usage, connector restart/resume context and cancellation, without external model credentials                                                                 |
| Desktop types/unused exports            | `ts-check` and `knip` passed; three pre-existing knip configuration hints                                                                                                                                                        |

The working-tree Pi archive was packed twice with the canonical Rust CLI and
compared byte-for-byte before extraction: `25241` bytes, SHA-256
`af4af68681032dea63f0585572d862260d2656ed844520816782143bf1d614aa`.
Its QA metadata deliberately identifies an inert fixture. This does not establish
committed-source provenance, artwork rights, production approval, x86 execution,
authenticated-model/tool-permission conformance or signed-feed installation.

## Live development-service API

The final run used the current debug binary with explicit CLI database, settings,
port and token arguments plus an independently generated QA-only public trust pin.
Twenty signed, local revision fixtures were seeded manually; nothing was published
or downloaded from a remote registry to manufacture installation evidence.

- Signed inventory and verified HTML asset serving passed.
- A paused `20 MiB` response retained its selected revision during uninstall and
  subsequently delivered its exact expected digest.
- Unleased historical revisions and a complete private orphan stage were reclaimed.
- Partial/unknown staging, a symlink and its outside sentinel were preserved.
- A SQLite sentinel database retained its exact bytes; every QA database was kept.
- Inventory became empty and new asset requests returned `404` after removal.
- Reseeding a fixture pointer allowed a later mutation to prove that the completed
  stream's revision became reclaimable. This is not a network reinstall test.

The fixture initially gave the complete orphan stage public directory permissions;
the service correctly preserved it. After correcting the fixture permissions, the
whole scenario passed. A prior unconfigured-trust run also correctly refused the
signed inventory rather than bypassing verification. Owned QA listeners were
stopped; the existing production app was not stopped. The final normal build
was checked to contain no QA public pin.

## Debug-startup isolation incident

The first ordinary `pnpm dev` attempt did not honor environment-only QA paths:
debug startup uses `dotenvy::from_path_override`. It selected the existing worktree
development database, created a pre-migration backup, applied automatic migrations
and pruned one superseded backup under the app's existing rotation policy before
it was stopped. No feature API test was run against that database. The production
database was not selected; no restore or manual database deletion was attempted.
A read-only comparison of migration bookkeeping against the newly retained backup
confirmed five additional migrations (`63` → `68`). This is not a claim that the
worktree development data remained unchanged.

Subsequent runs used explicit CLI paths, which take precedence over dotenv.
Turbo also filtered the ad-hoc compile-time QA trust inputs, so the final debug
binary was built explicitly through `pnpm rust` and its test public pin verified
before isolated execution. This report does not claim ordinary dotenv-selected
`pnpm dev` or Electron UI qualification.

## Remaining delivery gates

- Select reviewed publisher and compatibility values; resolve Pi artwork
  provenance and approve the supported public target matrix.
- Deliver a new CLI from green `main`, qualify the distributed artifact for all
  three kinds, then review/update registry and author pins and bootstrap hashes.
- Deploy the registry workflows and protected production authority separately.
- Publish immutable official releases/contributions, then qualify actual trusted
  feed clients before a separately authorized desktop activation release.
