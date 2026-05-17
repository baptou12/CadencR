# Changelog

## v0.1.2 - 2026-05-17

Previous release: v0.1.1

### Added

- Added a release command workflow to prepare changelogs, validate versions, run release preflight checks, and create annotated release tags.
- Added support for changelog-only releases when no landing news article is needed.

### Changed

- Documented the Cloudflare deployment setup for the landing site.
- Published GitHub release notes from the changelog section used for each release.
- Cleaned desktop test output by replacing console error filtering with MSW-based handling.

### Fixed

- Included the session id in the OpenCode resume command.
- Started the agent turn timer correctly when bootstrapping from a paused state.
- Hardened updater installation behavior and CI release workflows.
- Enabled pnpm before setup-node caching in CI.
- Configured Git identity in the workflow harness.
- Avoided Codex runtime requirements in command kind coverage tests.
