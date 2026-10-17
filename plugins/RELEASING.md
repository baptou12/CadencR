# Independent official plugin releases

## Scope

- Tags: `plugins/provider-pi/v0.4.0`, `plugins/theme-graphite/v0.1.0`,
  `plugins/theme-ember/v0.1.0`, `plugins/theme-fjord/v0.1.0`.
- Never use desktop `v*` tags. Plugin versions do not change app versions.
- `release-policy.json` records theme source versions because theme documents have
  no package version. Pi uses its own `package.json` version.
- This preparation adds no tags, releases, registry entries or marketplace activation.

## Preparation contract

The workflow checks the exact tag's commit and official tracked source paths.
It downloads only the checksum-pinned **production released CLI** using the shared
fetcher. `PENDING` pins fail the job; no qualification-pin or source-build fallback.
The canonical CLI validates and packs each theme twice and exact bytes must match.
Only `theme.json` is staged. Pi preparation refuses to invent native targets or
package metadata while those decisions remain pending.

Public output is limited to the archive, `SHA256SUMS` and `release.json`, which
binds tag, version, source path, full source commit and archive digest/size. CLI
receipts containing private runner paths, logs, keys and environment are excluded.
This is preparation metadata, **not** a registry package or signed author submission.
Namespaced tag URLs are encoded by the shared Rust original-author engine.

## Closed publication gate

The tag workflow remains preparation-only. A separate manual author workflow is
implemented but closed by `PENDING` policies and its own unreleased-CLI pin.
No author credential, protected environment or registry signing key is provisioned
by this implementation. See the activation gates below.

Before enabling official publication, review:

- [ ] Source licenses and Pi artwork provenance.
- [ ] Pi supported native targets and canonical registry package metadata.
- [ ] Generic-host conformance and real supported-platform behavior.
- [x] Registry CLI publication/resume/recovery/renewal qualification with the distributed
      `0.13.1-dev.38974097824.1` binary in the isolated public QA registry.
- [ ] Deliver and qualify the original-author CLI commands; registry mirror commands
      are not an original-author publication shortcut.
- [ ] Production CLI pin promotion and registry cutover.
- [ ] Protected signing authority and author-publication policy.

Environment approval alone cannot resolve these decisions. Future signing and
publication must use the shared released Rust CLI and revalidate the exact artifact
and source binding; do not introduce an alternate JavaScript publication path.

## Shared original-author engine

`cadencr-registry-publisher::author_release` now owns the original-author GitHub
inspection, content-bound draft publication and reconciliation state machine.
The desktop service delegates to this same library while retaining credentials,
project/database access, confirmation and operation journaling in the service.
Registry mirrors and signed catalog publication remain distinct operations.

The shared engine preserves the connected account, numeric repository identity,
exact source-tag commit, notes, binding digest and every expected archive/metadata
asset. It supports namespaced tags such as `plugins/theme-graphite/v0.1.0`, without
allowing slashes in asset names. Fixture tests cover interrupted writes, exact
read-only retries, changed sources and safe tag URL encoding.

The CLI now exposes two thin commands over that engine:

```sh
cadencr plugin inspect-release --request request.json --directory /canonical/artifacts
cadencr plugin publish-release --request request.json --directory /canonical/artifacts \
  --confirm-request-sha256 <reviewed-exact-request-digest>
```

- Inspection is fully local and needs no token. Its single JSON receipt contains
  the reviewed request and its exact-byte SHA-256, never local filesystem paths.
- Publication validates the request, content digests and confirmation before
  reading `CADENCR_AUTHOR_GITHUB_TOKEN`. Retry the same request after an unknown
  result; the shared engine reconciles the existing draft or published release.
- Portable schema `1` binds repository/account/numeric repository ID, tag/source
  commit, notes/prerelease and every asset's safe basename, byte size and digest.
  Unknown fields, unsafe paths, symlinks, duplicate names and oversized inputs fail.
- `metadata` is bounded opaque release documentation, **not** a validated registry
  package or submission. This command grants no signing or registry authority.

The previously qualified distributed CLI does **not** contain these new commands.
Their source/fixture checks do not qualify a released binary. Keep production
policies and the dedicated author pin `PENDING` until delivery and qualification.

## Protected manual author workflow

`official-plugin-author.yml` runs only from trusted `main`. It reads candidate
theme Git objects as data and never executes candidate scripts or accepts artifacts
from another run. Both jobs independently reconstruct the same source-bound request.

| Dispatch input   | Meaning                                                                |
| ---------------- | ---------------------------------------------------------------------- |
| `source_commit`  | Exact reviewed full commit containing approved theme source/policy     |
| `tag`            | Existing `plugins/theme-<name>/v<version>` tag at that commit          |
| `request_sha256` | Sixty-four zeros inspect only; the emitted digest confirms a later run |

Publication is conditional on the exact reconstructed digest and a separate
`official-plugin-publication` environment. The author secret is available only to
the final CLI step; catalog signing and registry submission are not included.
Pi remains refused until its packaging/target/conformance gates are closed.

Before activation, all of the following require explicit review:

- Deliver and qualify the actual author-capable binary; set
  `scripts/official-plugin-author-cli.env` to its exact version/tag/checksum.
- Review `scripts/official-plugin-author-policy.json`: numeric repository ID,
  expected author account, binary/pin digests and qualification evidence digest.
  Add `scripts/official-plugin-author-qualification.json` only after real binary
  qualification; its exact-byte digest and CLI version/checksum must match the
  policy. This reviewed summary is an attestation, not an automated certification.
- Approve both that policy and `plugins/release-policy.json`. `APPROVED` is an
  explicit future decision, not a state set by preparation or workflow dispatch.
- Provision the protected environment with reviewers, no self-approval or admin
  bypass, and `main`-only deployment rules; the workflow must not create it.
  Pin its numeric `environment_id` and explicitly review
  `admin_bypass_reviewed_disabled`. Runtime checks verify the existing environment,
  reviewers and branch rules. GitHub's documented response omits the admin-bypass
  setting, so its absence requires this reviewed attestation bound to that ID;
  an explicit API value enabling bypass is always rejected.
- Store a separately scoped user/bot credential matching the pinned account as
  `CADENCR_AUTHOR_GITHUB_TOKEN`. The engine authenticates via `GET /user`; the
  automatic Actions installation token is not a substitute. See
  [GitHub's supported user-token types](https://docs.github.com/en/rest/users/users#get-the-authenticated-user).

No tags, official releases, registry entries, desktop trust roots or marketplace
visibility are changed by landing this code.

## Offline qualification preparation

`sh scripts/official-plugin-release.sh --qualification <repo> <commit> <tag> <new-absolute-output>`
uses the existing qualification pins and labels the output `authority: qualification`.
This explicit read-only mode grants no production signing or publication authority;
the tag workflow never enables it. It still requires an existing source-bound tag.

## Repository authority and private scratch

Both modes require the checkout origin to identify `merkr-software/CadencR`.
Production also requires matching `GITHUB_REPOSITORY`, `GITHUB_SHA` and
`GITHUB_REF` tag context; qualification requires no GitHub execution context and
never grants production authority. Public metadata records the canonical repository
identity, never the local checkout path.

Private scratch is retained and its path printed to stderr on packaging attempts.
There is no recursive cleanup: an unexpected database created in CLI HOME must
not be deleted. Review retained scratch separately; never upload it.
