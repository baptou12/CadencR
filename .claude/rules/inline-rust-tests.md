---
paths:
  - "**/*.rs"
---

In Rust source files, keep unit tests inline with the code they cover. Do not create or expand dedicated sibling test files like `tests.rs` just to hold unit tests for a module. If a Rust module needs more room, split production code into smaller modules or files, but keep each module’s unit tests in the same source file behind `#[cfg(test)]`.
