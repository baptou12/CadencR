# Provider catalog parity fixtures v1

These fixtures freeze the service-to-desktop catalog projection that the first
installed-provider UI slice will extend. They deliberately cover the two rich
reference providers first:

- `claude_code_catalog.json` pins Claude Code's synchronous fallback identity,
  model aliases, ordering, and default;
- `codex_catalog.json` pins Codex identity, model capability projection, effort
  ordering/deduplication, fast-tier detection, access modes, and default selection.

The fixtures are asserted by inline unit tests in the owning adapters. Codex uses
synthetic transport models so the test is deterministic and does not spawn a CLI;
Claude uses the adapter's deterministic bootstrap fallback rather than its
environment-dependent live probe.

A deliberate user-visible catalog change updates the owning adapter, companion
provider document, and fixture in the same commit. Do not record live CLI output
as a golden fixture: upstream model catalogs are mutable and machine-dependent.
