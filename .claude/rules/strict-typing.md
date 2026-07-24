---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

Never use `any` — use `unknown` and narrow with type guards, and validate external boundaries with Zod. (`typescript/no-explicit-any` is a hard oxlint error, so this fails the build, not just review.)
