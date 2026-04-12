---
paths:
  - "packages/service/src/**"
  - "packages/tauri/src/**"
  - "packages/*-sdk-rs/src/**"
---

Do not scatter provider-specific logic across shared codepaths.

- Provider SDKs are only for provider communication details.
- Provider adapters are where provider-specific business logic should live on the backend.
- Shared backend runtime, workflow, and API code should consume unified adapter interfaces and provider-neutral types.
- Shared frontend components, hooks, and stores should consume provider-neutral catalog/config data instead of hardcoded provider branches.
- If a provider needs special handling, extract it into a dedicated provider file or folder rather than adding another provider-specific conditional in generic code.
