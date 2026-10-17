# Original-author CLI — delivery and offline qualification

## Status

- Delivered and independently verified: author-capable Linux development CLI.
- Passed: real credential-free distributed-binary QA in a network-isolated runner.
- Pending: authenticated author publication, immutable retries and interrupted
  draft recovery. No claim of full author-publication qualification.
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

1. Approve/provision a user-associated `QA_AUTHOR_GITHUB_TOKEN` matching the
   candidate account, or review a new candidate for a dedicated bot account.
   The Actions installation token is not a substitute. No existing user token
   has been copied to the QA repository.
2. Run inert author publication with controlled empty-draft interruption; require
   same-release recovery, exact same-state/fresh-scratch retries, anonymous asset
   hashes and unchanged inventory after content/request tampering.
3. Only after that evidence passes, separately review production pin/policy and
   protected-environment activation. This QA evidence is not the production
   `official-plugin-author-qualification.json` attestation and grants no authority.
4. Continue official themes/Pi readiness, reviewed author releases and registry
   submissions before a later marketplace activation release.
