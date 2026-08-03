# Installed ACP providers (local descriptors)

> - **Status:** Backend contract implemented — capability DTO and desktop closure remain (`docs/PLUGIN_STRATEGY.md` §3)
> - **Last reviewed:** 2026-08-03
> - **Code:** `packages/service/src/domain/agents/providers/installed/`

An ACP agent joins Cadencr's provider list by dropping a descriptor file next to
the settings — no Rust, no TypeScript, no SDK crate.

## Where descriptors live

`<settings-dir>/providers/<agent-id>.json`, which is `~/.cadencr/settings/providers/`
in a packaged build and `<db-dir>/cadencr-settings/providers/` in a dev run.
The directory is scanned **once at startup**, in file-name order.

The file name must equal the agent's `id`. The directory is how a user manages
installs, so a file whose name disagrees with the identity inside it is refused
rather than silently trusted.

## Descriptor format

```jsonc
{
  // Cadencr host envelope version. Only `1` is understood today.
  "schema_version": 1,

  // Registry-shaped portable agent metadata.
  // https://github.com/agentclientprotocol/registry — agent.schema.json
  "agent": {
    "id": "acme-agent", // ^[a-z][a-z0-9-]*$
    "name": "Acme Agent", // display name; becomes the catalog label
    "version": "1.4.0", // MAJOR.MINOR.PATCH (suffixes allowed)
    "description": "An ACP agent",
    "repository": "https://github.com/acme/agent",
    "website": "https://acme.dev",
    "authors": ["Acme"],
    "license": "MIT",
    "icon": "https://acme.dev/icon.svg",

    // Optional only in Cadencr's hand-written local profile. The strict ACP
    // Registry validation profile requires this field.
    "distribution": {
      "binary": {
        "darwin-aarch64": {
          "archive": "https://github.com/acme/agent/releases/download/v1.4.0/acme-darwin-arm64.tar.gz",
          "sha256": "…64 hex chars…",
          "cmd": "acme",
        },
      },
    },
  },

  // Cadencr host policy. Never part of the portable entry.
  "installation": {
    "enabled": true, // default true
    "executable": {
      "command": "/opt/acme/bin/acme", // absolute path, required
      "args": ["acp"], // argument vector, never a shell string
      "env": { "ACME_REGION": "eu" }, // literal env for the child
    },
  },
}
```

Fields Cadencr does not model at the top level of `agent` are preserved verbatim.
The host envelope (`schema_version`, `installation`) is Cadencr's own, so an
unknown key there is a typo rather than a newer registry field: it is refused,
not ignored.

### Validation profiles

| Profile                      | `distribution` | Additional policy                                                       |
| ---------------------------- | -------------- | ----------------------------------------------------------------------- |
| Local host descriptor        | Optional       | Rejects ACP-owned capability fields and whitespace-only launch metadata |
| Strict ACP Registry v1 entry | Required       | Mirrors the pinned upstream `agent.schema.json` shape                   |

Both profiles validate every supplied registry field: URI-formatted
`repository`, `website`, and binary `archive`; id and version patterns;
distribution cardinality; platform keys; checksum syntax; and typed, non-null
properties. The upstream root schema permits additional properties, so unknown
root fields round-trip through `AcpAgentEntry::extra`. Its nested distribution
objects set `additionalProperties: false`, so unknown nested fields are rejected
rather than silently dropped.

The vendored upstream snapshots live at
`packages/service/tests/fixtures/acp_registry/v1/`: the v1 schema plus a real
`claude-acp` entry. Tests validate the entry and compare its serialized value to
the original JSON, making schema drift or data loss an explicit source change.

**A descriptor may not declare capabilities.** No models, modes, permission
maps, thought levels, or auth methods. Those are owned by the protocol and
discovered through `initialize` and `session/new`; a descriptor field claiming
one would override what the agent actually negotiated. Such a field is not
quietly dropped — an `agent` entry carrying one is rejected outright with
`DESCRIPTOR_SCHEMA_VIOLATION`, because a silently ignored `"models"` key looks
honored and is not.

## What this build does and does not do

| Supported                                          | Deferred                                 |
| -------------------------------------------------- | ---------------------------------------- |
| ACP v1, negotiated by the shared client            | ACP v2                                   |
| An explicitly selected local executable            | Downloads, archive extraction, checksums |
| Startup loading                                    | Hot install / reload                     |
| Enable / disable via `installation.enabled`        | Marketplace publishing and desktop UI    |
| Strict v1 validation and lossless typed round-trip | Registry ingestion/export workflow       |

## Requirements on the agent

The runtime baseline from `BOUNDARIES.md` §"Minimum ACP v1 admission contract":
`initialize` at protocol version 1, `session/new`, `session/prompt`,
`session/cancel`, and `session/update`, with standard JSON-RPC errors for
optional methods it does not implement. Optional capabilities widen what the
workspace can offer; they are never an admission requirement. The current
startup scan does not preflight this handshake: an executable that fails it is
accepted by the loader and fails visibly when first spawned. A bounded
conformance probe remains Phase 8 work.
`packages/service/tests/fixtures/fake_acp_agent.py` is a working minimal
example. `tests/installed_acp_provider_test.rs` exercises it through the
runtime registry and the authenticated HTTP + real WebSocket host surfaces,
including interruption of an active turn.

## When a descriptor is refused or quarantined

`GET /api/agents/installed-providers` lists what the scan loaded and what it
refused, and every failure is also logged at startup. Two outcomes, deliberately
distinct:

**Rejected** — never becomes a provider, because its identity or shape could not
be trusted:

| Code                           | Meaning                                                    |
| ------------------------------ | ---------------------------------------------------------- |
| `DESCRIPTOR_UNREADABLE`        | The file (or the directory) could not be read              |
| `DESCRIPTOR_INVALID_JSON`      | Not valid JSON                                             |
| `DESCRIPTOR_SCHEMA_VIOLATION`  | JSON, but not a valid host envelope / ACP registry entry   |
| `UNSUPPORTED_SCHEMA_VERSION`   | `schema_version` is from a newer build                     |
| `DESCRIPTOR_IDENTITY_MISMATCH` | File name and `agent.id` disagree                          |
| `DUPLICATE_PROVIDER_ID`        | A built-in or an earlier descriptor already owns the id    |
| `UNSUPPORTED_DISTRIBUTION`     | No `installation.executable`; this build downloads nothing |
| `INVALID_EXECUTABLE_PATH`      | The command is empty or not absolute                       |

**Quarantined** — a valid install that cannot run right now. It stays registered
and renders as unavailable with the reason attached, instead of disappearing.
`quarantine_code` (with `quarantine_message`) is the single availability signal;
the catalog's `unavailable` status is derived from it:

| Code                        | Meaning                                                    |
| --------------------------- | ---------------------------------------------------------- |
| `INCOMPATIBLE_PLATFORM`     | The declared distribution names no target for this OS/arch |
| `EXECUTABLE_NOT_FOUND`      | The resolved path is not on disk                           |
| `EXECUTABLE_UNREADABLE`     | The path could not be inspected (permissions, bad path)    |
| `EXECUTABLE_NOT_EXECUTABLE` | The path exists but is not an executable file              |

Built-in providers register first, so a descriptor can never take an id they
own — the descriptor loses and says so. Enablement does not enter into it: a
disabled descriptor still owns its id, so a collision is refused at load time
rather than becoming a surprise the day the user enables it.

`executable` is reported without its argument vector. An argument can carry a
credential (`--token …`) and, unlike a fixed set of environment names, there is
no generic way to redact one.

## Security notes

The executable is exec'd directly with its argument vector — deliberately unlike
the built-in ACP adapters, which go through `$SHELL -l -c "exec …"`. Descriptor
data is marketplace data and must never become shell syntax, and the service
already hydrates its own environment from the login shell at startup, so the
child still inherits a terminal-like `PATH`. A relative command is refused
rather than resolved through `PATH`. Environment values are host launch
policy: they are never returned by the API and never logged. The process
boundary is **not** an OS sandbox — a local descriptor points at a binary the
user chose, and the marketplace safety work (signing, checksums, blocklist,
sandboxing) in `BOUNDARIES.md` Phase 8 lands before any downloaded agent ships.
