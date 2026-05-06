# Security Policy

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

The preferred channel is **GitHub's private vulnerability reporting**:

→ **[Report a vulnerability](https://github.com/rle-mino/cadencr/security/advisories/new)**

That flow creates a private draft advisory where the maintainer and the reporter can work on the fix together, assign a CVE, and publish coordinated disclosure when a patched release is out.

If GitHub PVR is not available to you, email **raphael.leminor@gmail.com** as a fallback with:

- A short description of the issue and why it is a security concern.
- Steps to reproduce, or a proof-of-concept if you have one.
- The version or commit SHA affected.
- Your preferred name / handle for eventual credit (optional).

Expect an acknowledgement within a few days.

## Scope

Cadencr is a local-first desktop app. The most relevant attack surfaces are:

- The local Rust service (HTTP + WebSocket) and its auth-token handling.
- The Electron shell and any filesystem / IPC boundary it exposes.
- The bundled agent SDKs (`claude-agent-sdk-rs`, `opencode-sdk-rs`) and how they spawn and stream local CLI processes.
- Handling of user-provided project paths, prompts, and agent output.

Issues that require a pre-compromised machine (for example, arbitrary code execution when the attacker already has shell access as the user) are generally out of scope.

## Supported versions

Only the latest `main` and the most recent tagged release receive security fixes. Older releases are not backported.

## Credit

With your consent, you will be credited in the release notes and changelog for the fix.
