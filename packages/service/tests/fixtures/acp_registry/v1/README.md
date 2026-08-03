# ACP Registry v1 fixtures

These files are pinned test inputs copied from the upstream
[`agentclientprotocol/registry`](https://github.com/agentclientprotocol/registry)
repository on 2026-08-03:

- `agent.schema.json` — the then-current v1
  [`agent.schema.json`](https://raw.githubusercontent.com/agentclientprotocol/registry/main/agent.schema.json);
- `claude-acp.agent.json` — the then-current
  [`claude-acp/agent.json`](https://raw.githubusercontent.com/agentclientprotocol/registry/main/claude-acp/agent.json)
  entry.

They are intentionally vendored rather than fetched during tests. Updating the
snapshot must be a reviewed change: adjust the Cadencr validation profiles and
their regression tests in the same commit when the upstream schema changes.
