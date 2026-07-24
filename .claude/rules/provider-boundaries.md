---
paths:
  - "packages/service/src/**"
  - "packages/desktop/src/**"
  - "packages/*-sdk-rs/src/**"
---

Cadencr is provider-neutral by design — don't scatter provider-specific logic across shared codepaths.

- `packages/*-sdk-rs/` crates carry transport and protocol details only.
- Provider-specific business logic belongs in that provider's backend adapter (`packages/service/src/domain/agents/providers/`).
- Shared backend runtime, workflow, and API code consumes the unified adapter interface and provider-neutral types.
- Shared frontend components, hooks, and stores consume provider-neutral catalog/config data — no hardcoded provider branches.

When a provider needs special handling, extract it into a dedicated provider file or folder rather than adding another conditional to generic code.
