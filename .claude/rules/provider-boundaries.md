---
paths:
  - "packages/service/src/**"
  - "packages/desktop/src/**"
  - "packages/*-sdk-rs/src/**"
---

Cadencr is provider-neutral by design — don't scatter provider-specific logic across shared codepaths.

- `packages/*-sdk-rs/` crates carry transport and protocol details only.
- Provider-specific business logic belongs in that provider's backend adapter directory (`packages/service/src/domain/agents/<provider>/`, e.g. `claude_code/`, `codex/`, `cursor/`, `opencode/`). `packages/service/src/domain/agents/providers/` holds the shared registry and provider-neutral resolution, not per-provider behavior.
- Shared backend runtime, workflow, and API code consumes the unified adapter interface and provider-neutral types.
- Shared frontend components, hooks, and stores consume provider-neutral catalog/config data — no hardcoded provider branches.
- Built-in providers are registered at runtime through `providers/registry.rs`; shared code resolves adapters via `provider_registry()` / `runtime_adapter()` and must not re-derive a provider list.

When a provider needs special handling, extract it into a dedicated provider file or folder rather than adding another conditional to generic code.
