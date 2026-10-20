# Original-author CLI — delivery and GitHub qualification

## Status

- Delivered and independently verified: author-capable Linux development CLI.
- Passed: real credential-free distributed-binary QA in a network-isolated runner.
- Passed: authenticated inert-theme publication, immutable retries, observed
  empty-draft interruption/recovery and separate fresh-runner reconciliation.
- Not exercised: arbitrary mutation-response loss, Pi runtime or production
  signing/publication. The QA result does not authorize those operations.
- Unchanged: production pins/policies, signing authority, official plugin releases
  and hidden desktop marketplace. No desktop release or canonical monorepo `main`
  push by this work.

## Distributed binary

| Binding        | Value                                                              |
| -------------- | ------------------------------------------------------------------ |
| Version        | `0.13.1-dev.39060688472.1`                                         |
| Source main    | `ce63c6e4d4d2060cf7b4b3d4e72c7591c37b2e7a`                         |
| Binary         | `cadencr-v0.13.1-dev.39060688472.1-x86_64-unknown-linux-gnu`       |
| Binary SHA-256 | `be1369550f9717dd2404893b30e7aae4be61a0baaac3f3aa40937500d094926f` |
| Binary bytes   | `5269376`                                                          |

- [Canonical CI](https://github.com/merkr-software/CadencR/actions/runs/39059631362)
  and [CodeQL](https://github.com/merkr-software/CadencR/actions/runs/39059631368): success.
- [CLI-only release run](https://github.com/merkr-software/CadencR/actions/runs/39060688472): success.
- [Public prerelease](https://github.com/merkr-software/CadencR/releases/tag/cli/v0.13.1-dev.39060688472.1):
  exactly the ELF, `SHA256SUMS`, `released-cli.env` and `provenance.json`.
  All four were downloaded anonymously and checked independently. The checksum,
  pin and provenance bind the exact version, source, workflow, run and attempt.

## Isolated Linux QA

| Binding                            | Value                                                              |
| ---------------------------------- | ------------------------------------------------------------------ |
| Public repository                  | `merkr-software/cadencr-registry-qa`                               |
| Numeric repository ID              | `1420296872`                                                       |
| Reviewed workflow/candidate commit | `d2de92f368cfbecc7b39d9dc38c1ef43f228d4f7`                         |
| Candidate-file SHA-256             | `80885eafa2119cc46b82d6b85645c3b1f97e464824bf91bf7050770519fedc60` |
| QA source tag                      | `qa-author-cli/ce63c6e4-39060688472`                               |
| QA source commit                   | `30b66c72546114849d1940b737dc13f88ac365f8`                         |
| Proof-file SHA-256                 | `2c592254347e463568924a186813b7a4d11912c92526f751d75e7d9c0f6ee659` |

[Run `39061002200`](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39061002200)
succeeded. Its `offline` job fetched the pinned released ELF without source
fallback, then executed it inside `unshare --net` after dropping privileges,
capabilities and inherited environment. No author secret was available.

The canonical CLI validated and packaged the inert declarative theme, inspected
the portable author request and rejected a wrong confirmation with the exact
expected structured error. The `author` job was **skipped** (`publish=false`).
The downloaded allowlisted proof was independently checked:

```json
{
  "bad_confirmation": "rejected",
  "cli_sha256": "be1369550f9717dd2404893b30e7aae4be61a0baaac3f3aa40937500d094926f",
  "cli_version": "0.13.1-dev.39060688472.1",
  "interrupted_draft": "not_exercised",
  "local_inspect": "passed",
  "publication": "not_requested",
  "request_sha256": "77ccc5c10ac85f48336faf8b86fafc8a343b341117be2ff4621f708ff5a2a13f",
  "schema_version": 1,
  "theme_source_sha256": "0f27a080e682810fc44452dc6e5f52bbef33c297242e032d2f8d2da45884cbfa"
}
```

## Authenticated publication and separate fresh-runner replay

The user explicitly provisioned the dedicated `QA_AUTHOR_GITHUB_TOKEN` secret.
Its value was never read or copied locally. It was exposed only to each author
job's final QA step, not to offline validation or artifact collection.

| Evidence                     | Value                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| Publication/interruption run | [`39061810127`](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39061810127) — success |
| Publication proof SHA-256    | `55351ff37637cdac2cd7589fb33a7fd029289c5aeefb46680249599b783c03b2`                                        |
| Separate fresh-runner run    | [`39061940386`](https://github.com/merkr-software/cadencr-registry-qa/actions/runs/39061940386) — success |
| Fresh-runner proof SHA-256   | `c4d443d82d4bc4a657e7bb738b28cbcc6aa9ac5e42d7ccb47cc9dde0f312ca0d`                                        |
| Same QA release ID           | `416010044`                                                                                               |

Both runs independently fetched the exact pinned distributed ELF and used the
same reviewed workflow/candidate commit, request digest, source commit and tag
recorded above. The first run held the upload connection, independently observed
an empty content-bound draft, terminated only its owned CLI child, then resumed
the same request into the **same release ID**. It exercised two completed retries,
including a fresh scratch/HOME. This is draft interruption/recovery, not a claim
of arbitrary lost-response recovery.

The second workflow ran on new GitHub-hosted Linux runners without prior local
state. It reconciled the existing published release. Both runs rejected changed
archive bytes and changed request bytes with exact expected diagnostics, then
independently verified unchanged public inventory.

The parent independently downloaded both public assets anonymously, verified
digests and sizes, and inspected the archive without extracting it. The archive
contains only the exact tracked inert `theme.json`; metadata is the opaque QA
document, not a registry package or submission.

| Asset           | GitHub ID   | Bytes  | SHA-256                                                            |
| --------------- | ----------- | ------ | ------------------------------------------------------------------ |
| `metadata.json` | `651358652` | `41`   | `5989f766d1884b4b88f88edcaea1ebab1ac261f72f9e9669bf595e86cc3520cc` |
| `theme.tar.gz`  | `651358539` | `1115` | `a7ba859dfa2579d17a168c4cdfc016189750f58a5ee142f4c0fd622ffcabe500` |

[Public inert release](https://github.com/merkr-software/cadencr-registry-qa/releases/tag/qa-author-cli/ce63c6e4-39060688472).
Its exact notes/binding, prerelease state, source tag and commit were verified.
All seven older releases remained unchanged. Comparing the eight release/asset
IDs, contents and mutation timestamps before/after the separate replay found no
changes; download counters were deliberately excluded from that comparison.
The QA repository's main commit and existing registry workflows/pins remained
unchanged. No production secret or registry signing operation was used.

## Harness review and limits

- Three independent reviewers completed reuse, quality and efficiency reviews.
  Corrections require exact negative diagnostics, shared operation/enclosing
  deadlines, `prlimit` rather than threaded pre-exec callbacks, and explicit
  proxy-failure rejection before accepting interruption evidence.
- Fifteen synthetic Python cases and the workflow/guard integration tests pass;
  the full root script suite passes **237 tests**, including normal commit hooks.
  These synthetic cases do not qualify real remote publication.
- Public QA deployment used an explicit reviewed file allowlist and a secret/path
  leak scan. All pre-existing QA blobs and seven releases were unchanged before
  the offline run. Existing registry workflows, CLI pin and signing key were not
  changed. Scratch is retained; no database was removed or replaced.

## Remaining gates

1. Separately review production pin/policy and
   protected-environment activation. This QA evidence is not the production
   `official-plugin-author-qualification.json` attestation and grants no authority.
2. Continue official themes/Pi readiness, reviewed author releases and registry
   submissions before a later marketplace activation release.
3. Revoke the temporary QA token after these completed QA runs; it is still
   stored as a repository secret. Secret deletion and token revocation are distinct,
   and neither was claimed or performed by this qualification.
