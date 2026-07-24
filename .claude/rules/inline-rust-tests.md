---
paths:
  - "**/*.rs"
---

Keep Rust unit tests inline, behind `#[cfg(test)]` in the file they cover — no sibling `tests.rs`. If a module needs more room, split the production code into smaller modules and keep each one's tests with it. Integration tests live in `packages/service/tests/`.
