---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

Never use `any` type. Use `unknown` when the type is truly uncertain, then narrow with type guards. All functions, parameters, and return values must have explicit types. Prefer interfaces for object shapes and use Zod schemas (already in the project) for runtime validation at boundaries.
