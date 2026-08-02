# Built-in provider-ID leakage inventory (service)

> - **Status:** Temporary inventory — deleted when the Phase 9 CI scanner replaces it
> - **Last reviewed:** 2026-08-02
> - **Scope of this file:** non-test Rust under `packages/service/src`
> - **Parent:** `docs/PROVIDER_SPEC/BOUNDARIES.md` (Phase 0, "Define the allowed
>   locations for built-in provider IDs and add a temporary inventory of existing
>   violations")

This is the Phase 0 artifact for one axis of the boundary: where the literal
strings `claude_code`, `codex_cli`, `cursor`, and `opencode` appear in service
code. It is **verified by hand**, not generated — a naive scan cannot tell a
provider id from a pagination `"cursor"` (`git/forge/github/review_threads.rs`,
`mcp/servers/workspace.rs`, `mcp/tools/project_list.rs`,
`mcp/servers/project_schema.rs`), and reporting those as violations would be
worse than reporting nothing.

The desktop-side leakage is already enumerated in `BOUNDARIES.md` §"Current
boundary violations" and is not repeated here.

## Allowed locations

A built-in provider id may appear in:

1. **the owning provider's adapter directory** —
   `packages/service/src/domain/agents/{claude_code,codex,cursor,opencode}/`
   and `packages/service/src/domain/agents/providers/opencode/`;
2. **its transport SDK crate** — `packages/{claude-agent,codex-app-server,cursor-agent,opencode}-sdk-rs/`;
3. **built-in registration metadata** —
   `packages/service/src/domain/agents/providers/registry.rs`;
4. **provider-specific tests, fixtures, documentation, assets, and importers** —
   including `packages/service/src/domain/imports/` and every `#[cfg(test)]`
   module or `handler/tests/` file.

Everywhere else, shared code may branch on negotiated protocol version,
declared capabilities, standard event kind, or a registered interface — never on
provider identity.

## Open violations (non-test service code)

| Site                                                   | Leak                                                                                                                       | Owning backlog item                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `domain/agents/runtime.rs:6`                           | `DEFAULT_PROVIDER: &str = "claude_code"` compiled into shared runtime                                                      | Phase 1 — persist the default by catalog id                                  |
| `domain/agents/providers/model_validation.rs:38-54`    | `PROVIDER_ALIAS_METADATA` table keyed by `claude_code` / `codex_cli` / `opencode`, with per-provider model guidance        | Phase 1 — registry-owned metadata                                            |
| `domain/agents/discovery/routes.rs:68-113`             | Four fixed discovery ids, four compiled SDK discovery specs, four override fields                                          | Phase 1 — installed provider descriptors + generic executable discovery      |
| `domain/agents/adapter/error.rs:75,94,105,116`         | `From<…SdkError>` impls in the shared error type name each provider's CLI (`"claude"`, `"opencode"`, `"codex"`, `"agent"`) | Phase 5 — remove provider-specific error variants from the shared error type |
| `domain/ws_session/auto_name/mod.rs:301`               | `if provider_id == "claude_code"` selects Claude profile env for the auto-name spawn                                       | Phase 5 — replace provider-name branches with adapter capabilities           |
| `domain/mcp/servers/project_schema_descriptions.rs:58` | `provider_alias_metadata("claude_code")` hard-codes which provider's guidance seeds the MCP `model` description            | Phase 1/5 — catalog-driven schema text                                       |
| `domain/ws_session/protocol/commands.rs:9-10`          | Provider ids in a doc comment only; no branch. Cosmetic, listed for completeness                                           | Phase 5                                                                      |

## Closed by the registry slice

- `domain/agents/providers/mod.rs` no longer holds a compile-time
  `static ADAPTERS: &[(&str, &dyn AgentRuntimeAdapter)]` list. Registration
  moved to `providers/registry.rs::BUILTIN_PROVIDERS`, which is allowed
  location 3.
- `valid_provider_ids()` is now a projection of the registry instead of a second
  hard-coded list, so the MCP `provider` enum
  (`mcp/servers/project_schema.rs:144`) and the MCP provider tool
  (`mcp/tools/project_providers.rs`) follow the registry automatically.
- `canonical_provider_id()` tests registry membership rather than the alias
  table for known ids.

## Not covered here

- Provider-specific **setting keys** (`claude_profile`, `codex_permission_mode`,
  `cursor_access_mode`, `thinking_effort_model_<provider>_<model>`). Those are a
  key-grammar problem tracked separately in `BOUNDARIES.md`; the adapter-owned
  `access_mode_setting_key()` is already the seam for two of them.
- Provider-native **tool names** and normalization tables.
- The desktop package.
- Any automated enforcement. The CI scanner with a reviewed allowlist is
  Phase 9; until it exists this file is the checklist.
