# Cadencr Provider Boundary and Marketplace Migration Plan

> - **Status:** Accepted direction; runtime registry and local ACP backend implemented, roadmap active
> - **Last reviewed:** 2026-08-09 against `v0.11.0`
> - **Scope:** Service, desktop, provider SDKs, CLI discovery, persistence, WebSocket APIs, and the provider marketplace
> - **Descriptor reference:** `docs/PROVIDER_SPEC/INSTALLED_ACP_PROVIDERS.md` — the implemented local-backend format and its refusal codes
> - **Parent plan:** `docs/PLUGIN_STRATEGY.md` — this document is step 2 ("bring your own agent") of the four-step extensibility ladder; the ladder's marketplace phasing, signing, and renderer invariants govern here too

## Executive decision

Cadencr's public behavioral contract for installable CLI providers will be the
[Agent Client Protocol (ACP)](https://agentclientprotocol.com/), not the Rust
`AgentRuntimeAdapter` trait, the current WebSocket event format, or a new
Cadencr-specific provider protocol.

- **ACP v1 is the production baseline.** It is the current stable protocol and is
  sufficient for a useful third-party provider: session creation, prompts,
  cancellation, streaming updates, tool calls, plans, permissions, MCP servers,
  configuration, usage, and optional session persistence.
- **ACP v2 is an opt-in draft target.** Its lifecycle, stable identifiers,
  upserts, structured diffs, terminal streams, and richer permissions are a
  better long-term internal model, but v2 must remain behind both negotiated
  protocol support and a Cadencr feature flag until it is stable.
- **v1 and v2 must coexist.** The version is selected during `initialize`; it is
  never inferred from an executable, package, crate, or marketplace version.
- **Marketplace distribution is the Cadencr registry; agent entries use the ACP
  Registry format.** The marketplace is the multi-content registry described in
  `docs/PLUGIN_STRATEGY.md` §7 (themes first, then agent manifests, then packs).
  Its agent payloads validate against the ACP Registry entry format so compatible
  entries can be imported and exported without losing ACP fields. The
  multi-content Cadencr envelope and stricter Cadencr host policy remain separate
  from the portable ACP payload. Installation and distribution metadata are
  separate from the negotiated runtime protocol.
- **Claude Code and Codex remain first-class.** Their rich native protocols may
  continue behind built-in adapters. The migration must preserve their current
  detail rather than reducing every provider to the lowest common denominator.
- **Capabilities drive the application.** Unsupported features are hidden or
  explained; they are not simulated, guessed from provider IDs, or made a
  marketplace admission requirement.

This document is a migration plan, not a new wire specification. Where ACP does
not define a feature, Cadencr may keep a contained built-in integration, but it
must not pretend that the feature is part of the public provider contract.
Marketplace eligibility must not depend on Cadencr-specific JSON-RPC methods,
`_cadencr` fields, or a private interpretation of `_meta`. (Cadencr already
uses `_meta` privately for the built-in Cursor adapter —
`clientCapabilities._meta.parameterizedModelPicker` and the `cursor/*`
extension methods; that first-party usage is exempt but must stay inside the
Cursor adapter.)

## Normative references

| Reference                                                                                               | Status                      | How Cadencr uses it                                                   |
| ------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------- |
| [ACP repository and protocol versioning](https://github.com/agentclientprotocol/agent-client-protocol)  | ACP v1 stable; ACP v2 draft | Version negotiation and schemas                                       |
| [ACP v1 initialization](https://agentclientprotocol.com/protocol/v1/initialization)                     | Stable                      | Baseline lifecycle and capability negotiation                         |
| [ACP v1 session configuration](https://agentclientprotocol.com/protocol/v1/session-config-options)      | Stable                      | Models, modes, thought level, and generic controls                    |
| [ACP v1 prompt turns](https://agentclientprotocol.com/protocol/v1/prompt-turn)                          | Stable                      | Prompt lifecycle, streaming, and usage                                |
| [ACP v1 tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls)                             | Stable                      | Tools, execution, edits, locations, raw input/output, and permissions |
| [ACP v1 agent plans](https://agentclientprotocol.com/protocol/v1/agent-plan)                            | Stable                      | Plan and todo projection                                              |
| [ACP v2 draft announcement](https://agentclientprotocol.com/announcements/acp-v2-draft)                 | Draft                       | Rollout constraints and design direction                              |
| [ACP v2 migration guide](https://agentclientprotocol.com/protocol/v2/migration)                         | Draft                       | v1/v2 translation and forward-compatible data modeling                |
| [ACP Registry entry format](https://github.com/agentclientprotocol/registry/blob/main/FORMAT.md)        | Current registry format     | Marketplace identity and distribution                                 |
| [ACP Registry JSON Schema](https://github.com/agentclientprotocol/registry/blob/main/agent.schema.json) | Current registry schema     | Manifest validation                                                   |

ACP documents are the authority if this plan and the protocol disagree. Because
v2 is a draft, its implementation must be isolated so schema changes do not
affect the stable v1 path or persisted Cadencr data.

## Contract boundaries

### Four separate contracts

The implementation must keep four concepts separate:

| Layer                       | Owner                                                             | Contract                                                                                                                   | Stability                           |
| --------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Marketplace distribution    | Cadencr registry, ACP agent-entry schema, and Cadencr host policy | Registry entry: identity, version, authors, repository, icon, license, executable distribution, arguments, and environment | Validated at install time           |
| Provider runtime            | Provider process and Cadencr ACP client                           | Negotiated ACP v1 or v2 over JSON-RPC                                                                                      | Public provider contract            |
| Canonical application state | Cadencr service                                                   | Version-neutral, lossless projection of ACP sessions and built-in provider events                                          | Private, versioned Cadencr contract |
| Desktop API                 | Cadencr service and desktop                                       | Provider-neutral snapshots and operations derived from canonical state                                                     | Private, versioned Cadencr contract |

The internal Rust adapter API is an implementation detail. A marketplace author
must never compile against Cadencr, import a Cadencr crate, or emit Cadencr's
internal WebSocket events.

### Executable boundary

Marketplace providers run as external ACP processes. Cadencr must not load
third-party dynamic libraries or execute third-party code in the service process.

The host owns:

- installation, executable resolution, checksums, and updates;
- process launch, termination, environment policy, and log redaction;
- protocol negotiation and conformance checks;
- persistence of installation state and user consent.

The provider owns:

- truthful ACP capabilities;
- sessions and prompt execution;
- provider authentication flows advertised through ACP;
- provider-native model, mode, tool, permission, and usage semantics translated
  into ACP.

### Minimum ACP v1 admission contract

A third-party provider is loadable when it can:

1. start as a configured executable and speak ACP JSON-RPC over its standard
   I/O transport;
2. complete `initialize` with ACP protocol version `1`;
3. advertise capabilities without claiming unsupported operations;
4. implement the v1 baseline session flow: `session/new`, `session/prompt`,
   `session/cancel`, and `session/update`;
5. accept `text` and `resource_link` prompt content, with other content types
   enabled only when advertised;
6. return standard ACP errors rather than terminating or changing message shape;
7. tolerate unknown extension fields and preserve `_meta` where the protocol
   requires forwarding.

Optional capabilities increase feature coverage but are not installation gates.
The marketplace UI must distinguish **installable**, **currently available**, and
**feature-complete for a given workflow**.

### ACP v2 opt-in contract

When both sides negotiate v2 and the feature flag is enabled, Cadencr must use
the v2 lifecycle rather than mixing v1 assumptions into v2 messages:

- `session/prompt` acknowledges acceptance; `state_update` communicates
  `running`, `requires_action`, and `idle` lifecycle changes;
- messages have stable IDs and are updated as complete values with explicit
  omitted, `null`, and value semantics;
- tool calls begin with `tool_call_update`; later updates patch the same ID, and
  content can arrive in chunks;
- diffs use structured changes, including add, delete, modify, move, and copy;
- terminal presentation is provider-owned and arrives through ACP terminal
  updates, snapshots, and base64 chunks;
- permission requests carry a title and an extensible subject such as a tool call
  or command;
- plans use identified plan updates;
- session resume and replay replace v1 load semantics;
- configuration uses generic `session/set_config_option` categories;
- unions and enums remain open, including unknown variants and implementation
  extensions prefixed with `_`;
- client-side tools are exposed through MCP rather than v1 client filesystem or
  terminal methods.

JSON-RPC batching may be supported for v2, but lifecycle-sensitive calls must not
be batched unless their ordering and failure behavior are proven safe.

## Preserve the existing provider experience

The public contract is capability-based, but the internal projection must retain
all details already exposed by Claude Code and Codex. The goal is to make rich
providers possible, not to flatten existing providers.

| User-visible capability                                     | ACP representation                                                                                      | Built-in parity requirement                                                                              | If unavailable                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Identity and installation                                   | Registry metadata plus agent information from `initialize`                                              | Preserve built-in names, versions, icons, and binary resolution                                          | Show unavailable state and actionable diagnostics                                |
| Models, modes, thought level, fast mode, and other controls | Session configuration options and their categories                                                      | Native adapters translate provider settings to generic options and return the authoritative updated list | Do not render unsupported controls                                               |
| Access and sandbox policy                                   | Standard configuration or permission semantics when advertised                                          | Keep Claude Code and Codex launch/access policy inside their adapters or host launch policy              | Explain that the provider does not expose the control                            |
| Text, images, audio, embedded resources, and links          | ACP content blocks gated by prompt capabilities                                                         | Preserve existing Claude/Codex attachment fidelity                                                       | Reject before sending with a clear capability error                              |
| Assistant text and thinking                                 | Message chunks in v1; identified message upserts/chunks in v2                                           | Preserve summarized and detailed thinking distinctions where the source provides them                    | Render the available message content only                                        |
| Tool calls                                                  | ID, title, kind, status, content, locations, raw input, and raw output                                  | Preserve Bash, search, fetch, edit, task, and provider-native details                                    | Use generic rendering based on ACP kind, never a provider-name guess             |
| Shell output                                                | Tool-call content in v1; terminal updates in v2                                                         | Preserve Codex command streams and Claude execution details                                              | Render standard tool content                                                     |
| File edits and diffs                                        | Diff content in v1; structured changes and optional patch in v2                                         | Preserve incremental patches, paths, moves, and final results                                            | Render supported change fields without reconstructing missing data               |
| Plans and todos                                             | Agent plan updates in v1; identified plan updates in v2                                                 | Preserve Claude todos and Codex plan progress                                                            | Hide the plan panel until a plan arrives                                         |
| Permissions                                                 | ACP permission requests and options; richer v2 subjects                                                 | Preserve once/session/future choices and provider-native scope where safely representable                | Pause the session and render the standard choices                                |
| Questions and elicitation                                   | ACP elicitation when negotiated                                                                         | Translate built-in question mechanisms in their own adapters                                             | Do not invent a tool-call name protocol                                          |
| MCP servers                                                 | ACP session setup and MCP capabilities                                                                  | Preserve built-in hot-swap and status behavior where supported                                           | Mark restart requirements explicitly                                             |
| Usage, context, and cost                                    | `usage_update` used/size and optional cost                                                              | Preserve authoritative context and cost fields from rich providers                                       | Label estimates as estimates; omit unknown values                                |
| Available commands                                          | `available_commands_update`                                                                             | Preserve native command discovery                                                                        | Do not maintain provider command tables in shared code                           |
| Cancellation and status                                     | v1 prompt completion/cancel; v2 state updates                                                           | Preserve receipts, interruption, and idle transitions                                                    | Use only negotiated lifecycle semantics                                          |
| Session list, resume, and close                             | Optional v1 session capabilities; v2 session baseline when advertised                                   | Preserve Claude/Codex resume fidelity                                                                    | Disable unsupported history operations without deleting local transcripts        |
| Subagents and background work                               | Standard tool calls and out-of-turn updates where supported                                             | Preserve built-in subagent trees through contained translation                                           | Render flat tool calls and explain that nested subagent detail was not available |
| Compaction                                                  | No dedicated ACP method, though Cursor (`/compress`) and OpenCode (`/compact`) already compact over ACP | Keep built-in compaction contained; existing ACP command paths keep working                              | Offer only an advertised command; never fake support                             |
| Plan approval workflows                                     | Permissions, elicitation, configuration, and standard updates                                           | Preserve Claude exit-plan and Codex collaboration workflows through adapters                             | Use the provider's standard interaction model                                    |
| Fork, rewind, and provider CLI import                       | Not part of the stable ACP baseline                                                                     | Keep as explicitly internal built-in capabilities                                                        | Do not expose for generic providers until standardized                           |

`docs/PROVIDER_SPEC/FEATURES.md` should become a parity and capability-coverage
ledger. It already is one de facto — its companions carry ✅/🟡/❌ matrices and
shipped providers violate the "requirements" today (OpenCode ❌ on MCP servers
and plan approval, Cursor ❌ on context usage) — so the reclassification is
documentation honesty, not a behavior change. Its "Adding a new provider"
section (a new Rust adapter directory plus a new SDK crate per provider)
directly contradicts Phases 1 and 7 and must be rewritten with it. The
per-provider documents remain regression references for built-in translation
behavior.

## Canonical internal model

### Required properties

The service needs a provider-neutral session projection with these invariants:

- stable IDs for sessions, messages, tool calls, plans, and terminals;
- explicit create, replace, patch, append, complete, and remove operations;
- tri-state patch fields where omission, `null`, and a value differ;
- all standard ACP content block variants;
- unknown variants and `_meta` retained without crashing or data loss;
- typed message role, tool kind, tool status, locations, diffs, terminals,
  permissions, plans, usage, cost, capabilities, and configuration options;
- provider identity stored as data, not used to select a shared-code branch;
- a typed internal semantic/presentation kind for rich built-in experiences such
  as shell, file edit, todo, and subagent views — adapters may derive it from
  provider-native detail, while generic ACP providers derive it from standard ACP
  fields when possible; raw and normalized tool names remain display data and do
  not control shared-code branches;
- a version on the desktop-facing contract plus tolerance for service/renderer
  skew — remote access ships a pre-built renderer, so mismatched versions are
  routine;
- raw protocol envelopes retained only in bounded diagnostics with secrets
  redacted;
- no raw provider or Claude-shaped event sent through the desktop WebSocket.

The canonical model may resemble ACP v2 because its identified upsert semantics
fit a stateful UI, but it must be owned and versioned by Cadencr. It is not a
replacement provider protocol.

### Target flow

```text
ACP Registry entry ──► installer / executable resolver
                              │
                              ▼
                     external ACP process
                              │ ACP v1 or v2
                              ▼
                    versioned ACP client codecs
                              │
                 ┌────────────┴────────────┐
                 │                         │
          generic ACP adapter       built-in adapters
                                     Claude / Codex /
                                     Cursor / OpenCode
                 │                         │
                 └────────────┬────────────┘
                              ▼
                 canonical session projection
                              │
                    persistence + snapshots
                              │
                              ▼
                  provider-neutral desktop API
```

Native built-in protocols may bypass the generic ACP client, but they must join
the flow only by producing the same canonical operations.

## Current boundary violations

This inventory identifies migration targets; it is not an instruction to rewrite
all files in one change.

| Area                                                                                             | Current coupling                                                                                                                                                                     | Required direction                                                                                                                           |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/service/src/domain/agents/providers/registry.rs`                                       | **Resolved.** `ProviderRegistry::startup()` is built from the `BUILTIN_PROVIDERS` factory table plus validated local ACP descriptors (`providers/installed/`)                        | Remaining work is distribution (downloads, checksums, signing), not registration                                                             |
| `packages/service/src/domain/agents/acp/runtime/lifecycle.rs`                                    | Hard-coded ACP v1 initialization, client filesystem/terminal, load, and modes                                                                                                        | Version-selected v1/v2 lifecycle modules                                                                                                     |
| `packages/service/src/domain/agents/acp/incoming.rs`                                             | Typed v1 requests (permission, fs; terminal deliberately raw); session-update notifications stay fully raw                                                                           | Versioned, typed codecs that preserve unknown fields                                                                                         |
| `packages/service/src/domain/agents/acp/runtime/turn_lifecycle.rs`                               | Assumes a v1 prompt response completes a turn                                                                                                                                        | Lifecycle state machine selected by negotiated version                                                                                       |
| `packages/service/src/domain/agents/acp/runtime/provider_hooks.rs`                               | 33-method hook trait (4 required, 29 defaulted as reviewed on 2026-08-02) shaped by Cursor/OpenCode quirks in shared runtime                                                         | Standard ACP behavior in codecs; provider quirks in the owning built-in adapter                                                              |
| `packages/service/src/domain/agents/adapter/adapter_trait.rs`                                    | Catalog, launch, session, UI policy, profiles, commands, permissions, branching, and compaction in one trait                                                                         | Small composable capabilities plus a session factory                                                                                         |
| `packages/service/src/domain/agents/adapter/event_types.rs`                                      | Index-based, Claude-shaped stream events and lossy content/usage                                                                                                                     | Canonical identified session operations                                                                                                      |
| `packages/service/src/domain/ws_session/handler/session_prompt/stream_reader_task_completion.rs` | Sends raw runtime JSON to the desktop WebSocket                                                                                                                                      | Project typed canonical operations into a versioned desktop DTO                                                                              |
| `packages/service/src/domain/ws_session/**`                                                      | Claude profile, Codex/Cursor access modes, OpenCode content shaping, and provider-name branches (the OpenCode question side-channel lives in the ACP hooks and the OpenCode adapter) | Provider-neutral commands and adapter-owned translations                                                                                     |
| `packages/service/src/domain/mcp/control/spawn_resolve.rs`                                       | Codex-specific spawn permission mapping                                                                                                                                              | Generic launch policy resolved by the selected provider factory                                                                              |
| `packages/service/src/domain/agents/discovery/**`                                                | Four compiled CLI path fields and SDK binary overrides                                                                                                                               | Installed provider descriptors plus generic executable discovery                                                                             |
| `packages/cli-discovery/src/types.rs`                                                            | Generic types that force compile-time `&'static` data; the per-provider definitions live in each SDK crate                                                                           | Owned manifest data that can be loaded at runtime                                                                                            |
| Service settings allowlist and generated APIs                                                    | Provider-specific setting keys and `claude_profile` / `codex_permission_mode` fields                                                                                                 | Namespaced provider installation data and generic config operations                                                                          |
| `packages/desktop/src/lib/providers.ts`                                                          | Fixed IDs, labels, icons, and default                                                                                                                                                | Catalog data returned by the service                                                                                                         |
| `packages/desktop/src/lib/provider-modes.ts`                                                     | Provider-specific mode arrays and normalization                                                                                                                                      | Render negotiated configuration options                                                                                                      |
| `packages/desktop/src/types/permission-mode.ts`                                                  | Fixed provider modes and encoded OpenCode agent IDs                                                                                                                                  | Standard permission/config types plus opaque stable option IDs                                                                               |
| `packages/desktop/src/lib/provider-access-modes.ts`                                              | Codex/Cursor-only tables and setting keys                                                                                                                                            | Capability-driven controls described by service data                                                                                         |
| `packages/desktop/src/lib/provider-model-aliases.ts`                                             | Frontend copy of Claude alias behavior                                                                                                                                               | Adapter-resolved canonical option IDs and labels                                                                                             |
| `packages/desktop/src/lib/prompt-attachments.ts`                                                 | MIME and attachment behavior selected by provider ID                                                                                                                                 | Prompt capabilities and standard ACP content blocks                                                                                          |
| `packages/desktop/src/lib/provider-resume-command.ts`                                            | Four-provider command switch                                                                                                                                                         | Session capability and service-issued actions                                                                                                |
| `packages/desktop/src/components/settings/ProvidersSection.tsx`                                  | One tab and component per compiled provider                                                                                                                                          | Installed-provider list plus schema-driven settings                                                                                          |
| Session controls, feature tabs, and info chips                                                   | Claude/OpenCode/Codex checks                                                                                                                                                         | Catalog capabilities and observed canonical state                                                                                            |
| Shared tool parsing/rendering                                                                    | Provider keys, tool names, and Cursor repair paths                                                                                                                                   | Standard tool kind/content first; built-in normalization before the boundary                                                                 |
| `.claude/rules/provider-boundaries.md`                                                           | Describes providers under a path that does not match all current directories                                                                                                         | Align the documented and enforced ownership boundary (project `CLAUDE.md` repeats the stale path; rule edits require `pnpm build:agents-md`) |
| `packages/service/src/domain/agents/runtime.rs`                                                  | `DEFAULT_PROVIDER: "claude_code"` compiled into shared runtime                                                                                                                       | Persisted catalog-ID default resolved from the registry                                                                                      |
| `packages/service/src/domain/imports/**`                                                         | Per-provider import branches (`claude_code_jsonl`, `codex_rollout`, `opencode_sqlite`) in shared service code                                                                        | Importer registry dispatched per installed provider                                                                                          |
| `packages/service/src/domain/mcp/servers/project_schema*.rs`, `mcp/tools/project_providers.rs`   | Provider ID enums and labels baked into the externally visible MCP tool schema                                                                                                       | Catalog-driven provider lists                                                                                                                |
| `packages/service/src/domain/settings_store/validate.rs` and settings repositories               | `thinking_effort_model_<provider>_<model>` key grammar validated in shared settings code                                                                                             | Namespaced provider settings storage                                                                                                         |
| `packages/desktop/src/components/import/*`, `onboarding/steps/DiscoverCliStep.tsx`               | Second hard-coded provider list/default in the import flow; four-provider onboarding discovery                                                                                       | Catalog-driven lists                                                                                                                         |
| `packages/desktop/src/stores/ws-envelope-*.ts`                                                   | `claude_profile` / `codex_permission_mode` fields handled in the shared WS store layer                                                                                               | Provider-neutral config payloads                                                                                                             |

## Implementation backlog

### Sequencing — the shippable slice comes first

This backlog is a multi-quarter program and must not merge as one unit. Per
`docs/PLUGIN_STRATEGY.md`, every step ships alone and leaves users better off.
The first shippable increment (ladder step 2, "bring your own agent") is:

- the Phase 0 parity fixtures and provider-ID inventory covering every built-in
  registration, discovery, and spawn path touched by the slice;
- the Phase 1 backend slice — the runtime registry, startup descriptor loader,
  and generic ACP provider factory (**implemented**);
- the minimum of Phase 8 — checksum verification, executable-plus-argument
  launch, and quarantine of incompatible versions (**launch and quarantine
  implemented**; checksums land with downloads, which the local-executable slice
  does not perform);
- the fake minimal ACP v1 executable test from Phase 9 (**implemented**).

The local descriptor slice is a backend substrate, not yet the complete
user-facing step 2b. The backend provides the first two closure items below; the third
remains the next step:

1. **Schema profiles are explicit (closed).** The local profile permits an
   omitted `distribution`; `AcpAgentEntry::validate_registry_entry` requires and
   validates the constraints represented by the pinned upstream v1 shape. URI formats, non-null typed
   properties, nested `additionalProperties: false`, binary `minProperties`,
   top-level lossless round-tripping, and a current upstream agent snapshot are
   fixture-backed under `tests/fixtures/acp_registry/v1/`.
2. **Host surfaces have automated coverage (closed).** The fake agent now
   crosses authenticated `GET /api/agents/installed-providers` and the real
   `/ws` session protocol over an ephemeral server. The test asserts a visible
   rejection, a visible quarantined install, session initialization, streamed
   text, completion, cancellation, and persisted runtime identity.
3. **Capability-driven UX is still missing.** The startup catalog can expose the
   provider identity and availability, but it has no provider-origin metadata or
   source badge, and negotiated session configuration is not yet projected into
   a generic desktop control surface. The desktop has no installed-provider
   diagnostics or management screen.

Phases 3, 4, and 6 (the canonical event model) are a separately tracked
workstream with their own migration plan. Phase 2's v2 client is deferred until
ACP v2 leaves draft: nothing in "install a third-party ACP agent" requires v2,
and an unwired `acp::v2` module fights the workspace's deny-`dead_code` and
`knip` gates until something consumes it.

### Implementation audit — 2026-08-09

The checkboxes below describe the complete provider-boundary program, not the
merge gate for the local-descriptor backend. At the current `v0.11.0` baseline,
the runtime registry and local ACP execution path are real production code, but
the canonical event model, capability-driven desktop, distribution installer,
and CI boundary enforcement remain future increments.

| Workstream                            | Current state                                                                                                                                                                | Next acceptance boundary                                                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Local ACP backend                     | Shipped: startup descriptors, generic adapter, direct execution, quarantine, diagnostics API, authenticated HTTP/WS integration tests                                        | Preserve this v1 path while later slices add UI and distribution                                                                                |
| Built-in regression guardrails        | `FEATURES.md` is an ACP-grounded coverage ledger and focused Claude/Codex catalog fixtures freeze the next UI slice; complete stream/workflow golden suites remain open      | Extend executable parity only for each later refactor's blast radius before removing its legacy path                                            |
| Installed-provider desktop            | Dynamic catalog entries can appear in existing selectors, but installed origin, source, diagnostics, enablement, and lifecycle are not presented or managed                  | Add catalog origin plus an installed-provider diagnostics view without exposing launch secrets                                                  |
| Negotiated capabilities/configuration | ACP v1 setup reads typed config options internally and observes authoritative replacements after model changes; the desktop still receives model/mode/access-specific shapes | Add a provider-neutral per-session capability/config snapshot and opaque `set_config_option` operation                                          |
| Canonical events and ACP v2           | Not started; current ACP runtime is fixed to v1 and still projects Claude-shaped/index-based runtime events                                                                  | Keep v2 deferred; design the versioned canonical state migration as a separate workstream                                                       |
| Marketplace distribution/security     | Local absolute executables only; schema validation, launch hardening, quarantine, and API redaction exist                                                                    | Downloads, integrity, signing, blocklist, process policy, install history, and conformance probing are still required before remote agents ship |
| Boundary enforcement                  | Runtime registry removes the central static provider list; remaining service leaks are hand-inventoried and desktop leaks remain widespread                                  | Add the provider-ID/dependency CI scanner only after the next containment slice establishes its allowlist                                       |

Recommended increments from this baseline:

The focused Phase 0 guardrail for the next slice is complete: `FEATURES.md` is a
coverage ledger, and deterministic Claude/Codex catalog fixtures pin the
service-to-desktop shape that origin metadata will extend. The remaining
increments are:

1. ship the first user-visible step 2b slice: catalog origin plus an
   installed-provider diagnostics screen backed by
   `GET /api/agents/installed-providers`;
2. add the generic ACP v1 session configuration bridge and desktop controls,
   preserving opaque option IDs and treating every returned option list as
   authoritative;
3. add local descriptor lifecycle operations (add, enable, disable, remove) with
   transcript preservation before building remote marketplace downloads;
4. then resume the independent Phase 3/4/6 canonical-event workstream. Do not
   pull ACP v2, downloads, signing, or third-party UI into the first step 2b PR.

### Phase 0 — Freeze parity and define ownership

- [~] Convert each built-in provider document into executable or fixture-backed
  parity cases, prioritizing Claude Code and Codex. Deterministic v1 catalog
  fixtures now pin Claude's bootstrap identity/models/default and Codex's rich
  model/access-mode projection. Cursor/OpenCode catalog fixtures and the wider
  workflow/stream cases below remain open.
- [ ] Record golden streams for text, thinking, tools, command output, edits,
      permissions, plans, subagents, usage, compaction, cancellation, resume, and
      errors.
- [~] Classify every existing feature as ACP baseline, ACP optional capability,
  host/marketplace policy, contained built-in extension, or unsupported until
  standardized. The 16 capabilities inherited from `FEATURES.md` now have an
  explicit class, with its mixed live-targeting/resume row split into separate
  baseline and optional entries. Identity/install state, prompt content types,
  auth, terminal presentation, session history, and other rows from the broader
  parity table still need to be incorporated before this inventory is exhaustive.
- [x] Reclassify `FEATURES.md` from universal requirements to a coverage ledger,
      rewrite its "Adding a new provider" section, and fix its stale
      `adapter.rs` path and `RuntimeAdapter` trait name. The ledger now identifies
      ACP baseline/optional behavior, contained extensions, and honest per-provider
      coverage; marketplace ACP providers explicitly require no Cadencr SDK or
      source change.
- [ ] Fix or explicitly annotate OpenCode's documented regressions (MCP servers
      not loading, plan approval unimplemented) before freezing golden fixtures
      around them.
- [x] Land `docs/PLUGIN_STRATEGY.md` in the repository so the parent plan is
      versioned alongside this document.
- [x] Define the allowed locations for built-in provider IDs and add a temporary
      inventory of existing violations —
      `docs/PROVIDER_SPEC/PROVIDER_ID_INVENTORY.md` covers non-test service Rust.
      The desktop package and the CI scanner (Phase 9) are still open.

### Phase 1 — Separate marketplace, discovery, and runtime registration

- [x] Replace the static adapter list with a runtime `ProviderRegistry`
      (`providers/registry.rs`). Lookups return an owned `'static`
      `ProviderAdapterHandle`; registration order stays user-visible.
- [x] Register built-in providers through factories using the same catalog shape
      consumed for installed providers. Stateless built-ins are already
      registry-owned (`ProviderAdapterHandle::owned`); Claude Code stays a shared
      `static` because its probe caches live inside the adapter value.
- [x] Add a generic ACP provider factory created from a validated installation
      record; adding one must require no Rust or TypeScript source change.
      `providers/installed/` loads `<settings-dir>/providers/*.json` at startup
      and registers each enabled entry through one `GenericAcpAdapter`.
- [x] Validate agent entries against the current ACP Registry schema
      (`agent.schema.json`); the Cadencr registry itself is multi-content
      (`docs/PLUGIN_STRATEGY.md` §7), so its envelope stays outside the portable
      ACP agent payload. Local validation may omit `distribution`; strict
      registry validation requires the constraints represented by the pinned v1
      shape, including URI
      formats, typed non-null properties, nested field refusal, binary target
      cardinality, platform keys, and checksum syntax.
- [x] Preserve registry fields rather than copying a subset into provider-specific
      tables. Known fields retain their portable shapes and unknown root fields
      round-trip through `AcpAgentEntry::extra`; the pinned `claude-acp` entry
      and a future root field are fixture-backed lossless cases. Nested unknown
      fields are rejected because the upstream schema explicitly forbids them.
- [~] Store resolved distribution, version, arguments, environment references,
  checksum, and install status as structured data. Identity, distribution,
  resolved executable/arguments/env, enablement, and compatibility state are
  structured on `HostInstallation`; checksums arrive with downloads
  (Phase 8), and env is still literal rather than by reference.
- [ ] Generalize CLI discovery to owned runtime data; remove the four fixed path
      fields and per-SDK override installation.
- [ ] Persist the user's default provider by catalog ID; do not compile a default
      such as `claude_code` into shared UI or service logic
      (`agents/runtime.rs::DEFAULT_PROVIDER`).
- [x] Update project `CLAUDE.md` ("Adding a provider is one registry edit") and
      `.claude/rules/provider-boundaries.md` when the registry becomes runtime
      data; regenerate the mirror with `pnpm build:agents-md`. The rule's stale
      adapter path was corrected at the same time.
- [x] Keep registry metadata, local executable overrides, and ACP capabilities as
      three distinct sources of truth — `descriptor.rs`, `installation.rs`, and
      the negotiated session in `acp/runtime/` respectively. A descriptor cannot
      declare models, modes, permissions, or auth.

### Phase 2 — Implement versioned ACP clients

> **Deferred — not on the step-2 critical path.** Ship the v1-only registry
> slice first; start this phase when ACP v2 approaches stability and something
> consumes the new module in the same change (deny-`dead_code` forbids unwired
> scaffolding).

- [ ] Move v1 protocol handling behind a complete `acp::v1` codec/lifecycle
      boundary.
- [ ] Add an isolated `acp::v2` draft codec/lifecycle boundary.
- [ ] Pin each implemented v2 draft to an exact upstream schema revision and
      record that revision in fixtures so draft changes are deliberate upgrades.
- [ ] Negotiate the protocol only through `initialize` and store the result on the
      runtime session.
- [ ] Require a Cadencr feature flag in addition to successful v2 negotiation.
- [ ] Support v1 and v2 sessions concurrently in the same application process.
- [~] Replace `serde_json::Value` parsing of known ACP events with typed decoding.
  Initialization and session setup use typed ACP v1 requests/responses, and
  permission/filesystem requests have typed decoders; session updates,
  terminal traffic, and several extension paths remain raw `Value`.
- [ ] Preserve unknown enum/union variants, extension methods, `_meta`, and
      unrecognized fields required for forwarding.
- [ ] Implement v2 prompt acknowledgement and state updates without v1
      stop-reason assumptions.
- [ ] Implement v2 identified messages, tool patches/chunks, plans, structured
      diffs, terminal presentation, permissions, session replay, and config options.
- [ ] Test JSON-RPC batches and reject unsafe lifecycle batching explicitly.

### Phase 3 — Replace the Claude-shaped event pipeline

- [ ] Introduce canonical session operations and a materialized session snapshot.
- [ ] Translate v1 index/chunk events into stable canonical IDs.
- [ ] Translate v2 IDs and upserts without losing tri-state patch semantics.
- [ ] Extend content beyond text/thinking/generic tool values to all negotiated ACP
      content types.
- [ ] Model tool title, description, kind, status, locations, content, raw input,
      and raw output as separate typed fields.
- [ ] Model diff operations, terminal streams, permissions, plans, usage, context,
      and cost explicitly.
- [ ] Persist canonical operations/snapshots rather than relying on provider raw
      envelopes as application state.
- [ ] Keep provider-native transcript files as an adapter-owned source of truth
      for rewind, fork, and CLI import (`docs/REWIND_AND_FORK.md` §7.2);
      canonical persistence replaces raw envelopes as application state, not as
      branching material.
- [ ] Plan the sqlx migration and backfill for the persisted event schema (see
      the `migration-safety` skill; every historical migrate fixture re-runs new
      migrations, and existing transcripts must remain readable).
- [ ] Generate a versioned desktop API from the canonical DTOs (three-edit rule:
      `build_api_routes()`, `openapi.rs`, committed orval regen; duplicate
      operationIds silently rewire unrelated generated hooks).
- [ ] Keep raw envelopes only in opt-in, size-bounded, redacted diagnostics.

### Phase 4 — Make session controls capability-driven

- [ ] Replace separate model, mode, effort, and provider-mode methods with generic
      configuration option reads and writes.
- [~] Treat the option list returned after each update as authoritative; providers
  may change dependent choices after a model or mode change. The ACP runtime
  decodes and observes replacement `configOptions` after model updates, but
  that state is still adapter-hook-local and is not projected to a generic
  desktop session snapshot.
- [ ] Preserve opaque option IDs and render provider-supplied labels/descriptions.
- [ ] Map known categories such as model, mode, model configuration, and thought
      level to consistent UI placement without hard-coding provider IDs.
- [ ] Generate prompt controls from advertised content capabilities.
- [ ] Expose session list/resume/close controls only when supported.
- [ ] Expose auth, MCP, command, permission, elicitation, usage, and terminal UI
      only from negotiated capabilities or observed standard events.
- [ ] Return a typed capability error when stale UI attempts an unavailable
      operation.

### Phase 5 — Contain backend provider behavior

- [~] Move Claude profile environment, model aliasing, bypass re-arming, plan-mode
  behavior, compaction, resume, and import rules into the Claude adapter.
  Most runtime decisions dispatch through the adapter now; shared session
  config/profile fields, auto-name environment selection, and importer paths
  keep this incomplete.
- [~] Move Codex permission/sandbox/collaboration mapping, command discovery,
  attachment translation, compaction, resume, and import rules into the Codex
  adapter.
  The adapter owns substantial runtime mapping, while MCP spawn policy,
  shared attachment/config shapes, and importer/orchestration seams remain.
- [~] Move Cursor metadata repair, model/mode synchronization, and tool
  normalization into the Cursor adapter.
  The Cursor hooks own the named translations, but the shared ACP hook trait
  is still shaped around Cursor metadata/config companions.
- [~] Move OpenCode question side-channel, agent modes, tool normalization, and
  permission fallback into the OpenCode adapter.
  The OpenCode adapter owns the implementations, while the shared ACP runtime
  still exposes question, fallback-permission, and tool override hooks made
  for those quirks.
- [~] Replace provider-name branches in `ws_session`, MCP spawn, auto-name, import,
  and session initialization with adapter capabilities or registry dispatch.
  Registry dispatch closed the central lookup path, but the temporary service
  inventory and desktop violations still identify live identity branches.
- [ ] Remove provider-specific error variants from the shared adapter error type;
      adapters should attach a stable generic code plus provider diagnostics.
- [~] Split the kitchen-sink adapter trait into small interfaces such as catalog,
  launch, session, configuration, persistence, and optional built-in
  extensions, following the existing `SessionBranching` seam
  (`adapter/branching.rs`, `docs/REWIND_AND_FORK.md` §7.1) as the template.
  `SessionBranching` proves the optional-interface seam; the rest remains on
  `AgentRuntimeAdapter`.
- [ ] Ensure shared ACP runtime hooks describe protocol-version behavior only, not
      named provider quirks.

### Phase 6 — Remove frontend provider knowledge

- [~] Load names, icons, descriptions, availability, settings, and capabilities
  from the service catalog. Provider IDs, labels, availability, models, modes,
  and access modes already flow from the catalog, while icons, descriptions,
  origin, settings schemas, and negotiated capabilities do not.
- [ ] Replace four settings panels with a schema-driven installed-provider view;
      keep custom built-in screens only as catalog-linked extensions.
- [ ] Render session configuration options generically and place related categories
      together.
- [ ] Remove provider ID checks from session controls, feature tabs, chips,
      attachments, resume commands, model aliases, and permission types.
- [ ] Render tools from a typed internal semantic/presentation kind. Generic ACP
      providers derive it from ACP kind, status, content, and locations; built-in
      adapters may enrich it from native detail before crossing the boundary.
      Never select a renderer by comparing provider-native or normalized tool-name
      strings.
- [ ] Run provider-specific repair before canonical events cross the service
      boundary; delete Cursor/OpenCode repair logic from shared frontend parsing.
- [~] Represent unsupported controls as absent or disabled with a reason from the
  capability model. Catalog availability and empty option lists already hide
  or disable some choices, but provider-ID tables still decide many controls
  and no negotiated session capability snapshot exists.
- [~] Preserve responsive streaming by selecting narrow store slices and applying
  canonical upserts without rebuilding complete histories. Narrow store
  selection is established on hot paths; canonical identified upserts do not
  exist yet.
- [x] Hold the renderer invariant: packaged CSP `script-src 'self'` never widens
      and no third-party JavaScript runs in the renderer; any built-in frontend
      extension hook is first-party only. `electron/main/csp.ts` enforces the
      packaged policy and `csp.test.ts` guards it; installed providers are external
      ACP processes and cannot contribute renderer code.

### Phase 7 — Keep SDKs transport-only

- [ ] Audit every `packages/*-sdk-rs/` crate for business decisions, UI policy,
      model catalogs, permission policy, and workflow behavior.
- [ ] Retain only protocol framing, process transport, generated wire types, and
      protocol-specific serialization in SDK crates.
- [~] Put provider-native to canonical translation in the provider's service
  adapter. Built-in adapters own substantial translation, but the shared ACP
  hook surface and frontend repair/tool-name paths show the move is incomplete.
- [x] Keep a generic ACP adapter free of named-provider hooks.
      `GenericAcpAdapter` uses `StandardAcpHooks`, whose required behavior is
      provider-neutral pass-through and whose optional hooks all decline.
- [x] Avoid requiring a new SDK crate for a marketplace provider that already
      speaks ACP. Every installed descriptor uses the same service-owned
      `GenericAcpAdapter` and shared ACP client.

### Phase 8 — Add marketplace safety and conformance

- [x] Validate identity and distribution data before installation. The local
      profile and strict ACP Registry profile share ids, versions, URI fields,
      distribution shapes, platform keys, and checksum syntax; the strict
      profile additionally requires `distribution` exactly as the pinned v1
      schema does. Download and integrity policy remain separate items below.
- [ ] Select only a distribution compatible with the current OS and architecture.
- [ ] Verify declared checksums and record the exact installed artifact, under
      per-id versioned install directories following the LSP downloader
      precedent (SHA-256 verification, `0700` permissions).
- [ ] Define integrity policy per ACP distribution: require SHA-256 for binary
      archives even though the ACP Registry field is optional; require exact
      package versions plus captured package-manager integrity/lock data for
      `npx` and `uvx`; reject moving versions and ranges.
- [ ] Extract archives defensively: reject path traversal and escaping symlinks,
      and require the declared executable to remain inside its versioned install
      directory.
- [ ] Re-verify the checksum and signed registry entry on every update, not only
      at install, and re-prompt when host-relevant launch policy changes. Runtime
      ACP capabilities reported by `initialize` are compatibility metadata, not
      a security permission manifest.
- [ ] Sign the registry index and ship a launch-fetched blocklist kill-switch
      before third-party content ships (`docs/PLUGIN_STRATEGY.md` §7, M1–M2).
- [x] Launch executable plus argument arrays directly; never interpolate a shell
      command from marketplace data. `GenericAcpAdapter::spawn` execs the
      resolved absolute path with its argument vector; relative commands are
      refused rather than resolved through `PATH`. This is a deliberate
      divergence from the built-in ACP adapters' `login_shell_exec_command`,
      documented at the call site so it is not "fixed" back.
- [~] Store secrets by reference, redact them from logs, and show environment and
  filesystem implications before first launch. The diagnostics API omits the
  argument vector and all environment names/values, but descriptors still
  contain literal values and there is no first-launch consent surface or
  complete process-log redaction policy.
- [ ] Apply process resource, lifecycle, and working-directory policy independently
      of ACP capabilities.
- [ ] Run a bounded conformance probe: launch, initialize, capabilities, create a
      disposable session if permitted, cancel, and clean shutdown.
- [x] Quarantine or clearly mark incompatible versions instead of crashing the
      provider catalog. A valid descriptor whose executable is missing, is not
      executable, or targets another platform stays registered and renders
      unavailable with its reason; a descriptor whose identity or schema cannot
      be trusted is refused outright. Both carry a stable SCREAMING_SNAKE code
      and are reported at `GET /api/agents/installed-providers`.
- [ ] Preserve local transcripts and installation history on disable or uninstall.
- [x] Distinguish ACP conformance from trust, publisher verification, and sandbox
      policy; protocol compliance is not a security endorsement. The installation
      model and its documentation explicitly separate machine compatibility,
      negotiated runtime capability, future conformance probes, and the not-yet-
      implemented trust/signing/sandbox policies.

### Phase 9 — Enforce the boundary in CI

- [ ] Add a provider-ID scanner with a reviewed allowlist limited to:
  - the owning provider adapter;
  - its transport SDK;
  - built-in registration metadata;
  - provider-specific tests, fixtures, documentation, assets, and importers.
- [ ] Fail CI when shared service or desktop code branches on a provider ID.
- [ ] Add dependency rules: shared runtime may depend on adapter contracts, but it
      may not import named provider modules; SDK crates may not depend on the service.
- [~] Validate every marketplace fixture against the registry schema. The pinned
  upstream v1 schema and `claude-acp` snapshot are validated and round-trip
  tested; the multi-content marketplace fixture set does not exist yet.
- [~] Add v1 and v2 protocol fixture suites, including malformed messages, unknown
  variants, `_meta`, tri-state patches, cancellation races, and process exits.
  A deterministic minimal v1 executable covers initialization, streaming,
  cancellation, and process use; v2 and the rich malformed/forward-compatible
  matrix remain open.
- [ ] Run Claude Code and Codex golden parity suites before removing any legacy
      path.
- [x] Add a fake minimal ACP v1 executable in integration tests and prove it can be
      installed and used without changing a provider list —
      `packages/service/tests/fixtures/fake_acp_agent.py` plus
      `tests/installed_acp_provider_test.rs` (catalog placement after the
      built-ins, session creation, streamed prompt, cancellation, and a
      duplicate-id refusal). The full refusal and quarantine matrix is covered by
      the unit tests in `providers/installed/`.
- [x] Drive the fake installed provider through the authenticated
      `GET /api/agents/installed-providers` route and the real WebSocket session
      protocol in automated integration tests, including a visible rejection
      and quarantine response. The WebSocket assertion covers initialization,
      streamed content, terminal completion, cancellation, and persisted
      provider/runtime ids.
- [ ] Add a rich ACP fixture to exercise permissions, plans, tools, diffs, MCP,
      usage/cost, configuration, commands, resume, and v2 lifecycle behavior.

## Allowed and forbidden dependencies

### Allowed provider-specific locations

- the provider's service adapter directory;
- the provider's transport/protocol SDK crate;
- built-in registration metadata and provider-owned assets;
- provider-specific tests, fixtures, documentation, importers, and migrations;
- a narrowly scoped **first-party** built-in frontend extension registered
  through the generic catalog, only when standard schema-driven UI is
  insufficient — third-party UI stays declarative; no third-party JavaScript in
  the renderer, ever.

### Forbidden shared-code patterns

```text
if provider == "claude_code" { ... }
switch (providerId) { case "codex_cli": ... }
const PROVIDERS = ["claude_code", "codex_cli", ...]
toolName === "some-provider-native-name"
settingKey = `${provider}_permission_mode`
```

Shared code may branch on negotiated protocol version, declared capabilities,
standard event kind, or a registered interface implementation. It may not branch
on provider identity.

## Migration rules

1. **Do not delete rich behavior before its canonical replacement is tested.**
2. **Do not widen the public contract to match an implementation shortcut.**
3. **Do not add new provider-specific fields to shared APIs or persistence.**
4. **Do not guess capabilities from executable names, versions, tool names, or
   provider IDs.**
5. **Do not silently downgrade data.** Unknown values are preserved; unsupported
   operations return a visible error.
6. **Do not treat ACP v2 draft shapes as stable persisted schemas.** Translate
   them into versioned Cadencr canonical data.
7. **Do not require every provider to implement every existing feature.** Require
   protocol correctness and describe feature coverage accurately.
8. **Do not ship v2 by default while it remains draft.** Negotiation and a feature
   flag are both required.
9. **Do not fill ACP gaps with a marketplace-only Cadencr wire extension.** Keep
   non-standard behavior inside built-in adapters until ACP standardizes it.

## Definition of done

The provider boundary is complete when all of the following are true:

- [~] A local descriptor can register a third-party ACP provider without
  rebuilding Cadencr; registry installation and desktop management remain
  open.
- [~] The provider appears in the backend catalog, initializes, starts a session,
  streams a prompt, and cancels without provider-specific source changes;
  generic capability/configuration projection remains open.
- [ ] ACP v1 remains the stable default and v2 can run side-by-side behind its
      explicit feature flag.
- [ ] Claude Code and Codex retain the detailed behavior documented in their
      provider specs and golden fixtures.
- [~] Cursor and OpenCode behavior remains contained behind their adapters. Their
  implementations live there, but the shared ACP hook surface and frontend
  provider-specific repair/config paths still encode their quirks.
- [ ] No raw or Claude-shaped provider event crosses the service-to-desktop
      boundary.
- [ ] Unknown ACP fields, variants, and `_meta` survive processing without a crash
      or accidental loss.
- [ ] All session controls and renderers are capability- or data-driven rather
      than provider-ID-driven.
- [~] Unsupported features are absent or explained instead of failing late. The
  generic adapter declines optional trait capabilities and quarantine reasons
  are visible, but the desktop lacks a negotiated capability model and generic
  installed-provider diagnostics UI.
- [ ] The provider-ID and dependency boundary checks pass in CI.
- [~] The generic v1 fixture, v2 draft fixture, and all built-in parity suites pass.
  The minimal generic v1 fixture passes; the v2 draft and built-in golden
  parity suites have not been created.
- [ ] Installation, first launch, interaction, restart, disable, and uninstall are
      verified in the running desktop application.

## Non-goals

- Designing a Cadencr-specific replacement for ACP.
- Requiring marketplace authors to implement Cadencr Rust or TypeScript APIs.
- Rewriting every built-in provider to speak ACP before the marketplace ships.
- Pretending provider-specific compaction, fork, rewind, profiles, or CLI import
  are standardized when they are not.
- Reducing Claude Code or Codex event detail to the minimum v1 baseline.
- Claiming ACP v2 is stable before the ACP project does.
- Treating skills or MCP servers as marketplace content — they are
  provider-portable configuration handled by a separate future helper
  (`docs/PLUGIN_STRATEGY.md` §8).
