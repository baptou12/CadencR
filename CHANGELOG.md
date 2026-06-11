# Changelog

## v0.4.1 - 2026-06-10

Previous release: v0.4.0 - 2026-06-07

### 🔧 Changed

- [**Desktop**] Improved prompt attachments so uploaded files are prepared per provider, making mixed text, image, and file prompts more consistent across agents.
- [**Backend**] Let custom actions run in a terminal split, so command output remains visible and recoverable instead of being limited to the action detail panel.
- [**Desktop**] Improved mobile workspace ergonomics with per-device zoom, a unified code font, touch-friendly diff controls, and safer prompt focus behavior when opening conversations.
- [**Backend**] Split websocket session protocol payloads into focused modules to keep live-session handling easier to maintain without changing the user workflow.

### 🐛 Fixed

- [**provider:codex**] Fixed PDF prompt attachments so Codex receives them as file references instead of unsupported inline content.
- [**provider:claude**] Fixed Claude Code context-usage bars so they scale against the session's real context window instead of the default 200k-token window.
- [**Desktop**] Fixed reused worktree branch selection so a manually chosen branch is preserved while project settings finish loading.
- [**Desktop**] Fixed custom-action recovery so runs that were active before restart no longer remain stuck.

## v0.4.0 - 2026-06-07

Previous release: v0.3.6 - 2026-06-03

### ✨ Added

- [**Desktop**] Added remote env: pair a phone, tablet, or second computer by QR code or link, then control the same local Cadencr workspace from the browser. Remote env includes host sidebar controls, pairing gate, trusted-device flow, installable PWA metadata/icons, mobile shell, mobile editor and terminal layouts, terminal key bar, live connected-device feedback, sleep-prevention controls, and connection fixes for multi-device, sleep/wake, re-pairing, stream model labels, and bidirectional session controls. On the backend it adds the remote listener, device-token authentication, pairing codes, TLS support, LAN/tunnel connection details, persisted remote devices, remote session mirroring, authenticated shared access to sessions, terminals, and LSP routes, plus loopback-only host controls, bearer-token checks, rate limiting, security headers, cache controls, and safer remote file handling.
- [**Desktop**] Added Monokai and Monokai Light themes.
- [**Desktop**] Added a feature unarchive action so archived work can be restored from the app.

### 🔧 Changed

- [**Desktop**] Reworked sidebar ordering so conversations float to the top after user messages while project order remains stable within a session.
- [**Backend**] Removed the 300-second custom-action timeout so long-running commands can continue until they finish or are cancelled.

### 🐛 Fixed

- [**Desktop**] Fixed terminal clear shortcuts so the terminal can be cleared reliably from the keyboard.

## v0.3.6 - 2026-06-03

Previous release: v0.3.5 - 2026-06-03

### ✨ Added

- [**Desktop**] Added a unified-agents "New session" button with project selection and `Cmd+Shift+N` / `Ctrl+Shift+N`, so new conversations can start directly from the agents view.
- [**Desktop**] Added `/exclude` filtering and per-agent hide controls to the unified agents view, making it easier to focus on the sessions that matter.
- [**Desktop**] Added command-palette and sidebar search shortcuts, plus a faster keyboard path for hiding and pinning agents.
- [**Backend**] Added session MCP server status support for OpenCode, Claude Code, and Codex so connected MCP servers can be surfaced while conversations run.

### 🔧 Changed

- [**Desktop**] Refined unified-agent filtering, filter help, card state, and sidebar links around hidden and excluded sessions.

### 🐛 Fixed

- [**Desktop**] Fixed session and query refresh behavior around shortcut-driven agent actions so UI state stays current after keyboard commands.
- [**provider:opencode**] Flattened OpenCode ACP tool results before display so tool output renders consistently in session streams.

### 🔒 Security

- [**provider:opencode**] Stopped logging raw OpenCode MCP discovery output so local MCP configuration details are not exposed in debug logs.

## v0.3.5 - 2026-06-03

Previous release: v0.3.4 - 2026-06-02

### ✨ Added

- [**Desktop**] Added a redesigned Settings page with grouped cards, clearer section headings, and more consistent controls for providers, themes, notifications, file icons, LSP servers, and permission modes.

### 🔧 Changed

- [**Desktop**] Kept gitignored files and folders visible in the editor file tree as dimmed entries, so ignored project files can still be opened without losing their status context.

### 🐛 Fixed

- [**Desktop**] Fixed empty-session cleanup so conversations without useful session content are deleted instead of being archived as clutter.
- [**provider:claude**] Fixed Claude Code model discovery so changing the active profile refreshes the model list immediately.
- [**provider:claude**] Fixed Claude sessions stuck in `bypassPermissions` so they can recover when the stored permission mode no longer matches the available launch capability.
- [**provider:codex**] Fixed Codex and ACP steering prompts after stop/resume so pending prompts are replayed and receipt state stays accurate.
- [**provider:codex**] Fixed Codex permission-mode persistence across session re-seeding so conversations keep the requested access mode.

### 🔒 Security

- [**dependencies**] Updated reviewed npm dependency overrides and lockfile entries for vulnerable transitive packages.

## v0.3.4 - 2026-06-02

Previous release: v0.3.3 - 2026-06-01

### 🔧 Changed

- [**Backend**] Ran provider CLI launches, worktree setup commands, and custom actions through a non-interactive login shell so user-installed tools are found without triggering zsh prompt/plugin startup errors.

### 🐛 Fixed

- [**Desktop**] Fixed websocket-backed sessions on feature pages so live agent status follows backend updates and prompt drafts stay cleared after sending.

### 🔒 Security

- [**Backend**] Restricted agent-requested ACP terminal commands to a small safe environment so provider-selected commands do not inherit user secrets unless they are explicitly passed through ACP environment variables.

## v0.3.3 - 2026-06-01

Previous release: v0.3.2 - 2026-05-27

### ✨ Added

- [**Desktop**] Added conversation imports for existing Claude Code, Codex CLI, and OpenCode sessions so prior agent work can be brought into a project as Cadencr features with provider and model context preserved.

### 🔧 Changed

- [**Desktop**] Reworked custom actions so the header shows up to four actions inline, inline and overflow actions share the same live output/details surface, and long-running manual runs remain visible and cancellable after menus close.
- [**Desktop**] Made archive cleanup safer by disabling destructive cleanup choices that would target the default branch or the main worktree.
- [**provider:claude**] Kept Claude bypass available as an explicit permission mode in the selector and Shift+Tab cycle while separating it from the underlying launch capability.

### 🐛 Fixed

- [**provider:claude**] Fixed Claude Code model handling on Anthropic, Bedrock, and Vertex by applying profile env to model discovery, preserving Claude Code's default system prompt, and resolving stored aliases to the active catalog model at launch.
- [**provider:claude**] Fixed Claude bypass reliability so sessions spawned without the capability can rearm before the next prompt and resume in the requested bypass mode.
- [**Desktop**] Fixed prompt drafts so they stay scoped to the feature instead of leaking or restoring across conversation switches.
- [**Desktop**] Fixed the sidebar label editor so rename opens reliably after the context menu closes.
- [**Desktop**] Fixed the Terminal tab so closing the last pane immediately starts a fresh focused terminal instead of leaving a blank panel.

### 🔒 Security

- [**Backend**] Hardened managed npm language-server installs by keeping lifecycle scripts disabled, requiring packages to be at least 14 days old, and enabling stricter pnpm trust controls.
- [**provider:claude**] Constrained Claude Code import session IDs to safe file names before loading local transcript files.

## v0.3.2 - 2026-05-27

Previous release: v0.3.1 - 2026-05-25

### ✨ Added

- [**provider:codex**] Added Codex access modes for new Codex conversations: Default, Full Access, and Auto Review, with the active access mode visible from the session meta bar and configurable in Settings.
- [**provider:codex**] Added per-session Codex access-mode persistence so existing conversations keep the mode they started with while new conversations use the current default.
- [**Desktop**] Added clipboard image paste support in the agent prompt so screenshots can be attached without drag-and-drop.

### 🔧 Changed

- [**Desktop**] Improved image prompt attachments by routing dropped images to the correct prompt and highlighting prompt cards while dragging.
- [**Backend**] Improved compact and resume handling so agent sessions recover pending compact state more reliably across backend and frontend lifecycle transitions.
- [**Backend**] Improved macOS SSH agent handling so terminals and Codex sessions preserve or recover `SSH_AUTH_SOCK` when Cadencr is launched from the GUI.

### 🐛 Fixed

- [**provider:codex**] Fixed Codex permission response timeouts so approvals and denials do not leave prompts stuck waiting.
- [**provider:claude**] Fixed a Claude Code bypass-permission issue where a rejected `bypassPermissions` switch could be handled like an `auto` compatibility fallback, leaving future prompts aligned to a rejected mode.
- [**Desktop**] Fixed a first-prompt permission-mode race so the mode selected before sending the first prompt is applied when the agent starts.
- [**Backend**] Fixed Git workflow operations so status, checkout, commit, and push actions avoid background lock conflicts.
- [**provider:claude**] Fixed Claude sub-agent close detection so closed sub-agent windows are classified correctly.

## v0.3.1 - 2026-05-25

Previous release: v0.3.0 - 2026-05-24

### ✨ Added

- Added editor previews for Markdown, HTML, SVG, and image files so generated docs and visual assets can be inspected without leaving Cadencr.
- Added broader `.env` file visibility in the file tree, file picker, editor, and language handling.
- Added sidebar grouping for features that share the same worktree, making related sessions easier to scan.

### 🔧 Changed

- Improved file-tree navigation by automatically revealing the active editor file.
- Improved live Git diff refresh behavior so changed files and viewed-state collapse stay in sync while work continues.
- Updated the new-session tips list to mention the new editor preview workflow.

### 🐛 Fixed

- Fixed SVG previews to run in a sandbox, while preserving preview zoom and `Cmd+W` / `Ctrl+W` close-buffer behavior.
- Fixed the file-tree agent shortcut so `Cmd+Shift+A` works when the file tree has focus.
- Fixed the Settings About row to use the Cadencr logo consistently.

## v0.3.0 - 2026-05-24

Previous release: v0.2.2 - 2026-05-20

### ✨ Added

- Added an LSP-powered editor workflow with Cmd-click go-to-definition, clickable symbol hints, diagnostics, server status, and an editor settings list for supported language servers.
- Added automatic language-server discovery, managed downloads, crash backoff, idle shutdown, and lifecycle controls so editor intelligence starts and stops with the active workspace.
- Added in-buffer search and replace, go-to-line, editor-scoped shortcuts, Markdown preview, and a free-buffer flow for starting a scratch file and saving it later.
- Added a fully reworked file tree with a new tree engine, better folder interactions, lazy ignored-directory loading, and configurable file icons.
- Added global agent verbosity modes so users can choose how much session detail Cadencr shows while agents work.
- Added One Dark and One Light themes, a global theme drawer, and theme-aware diff rendering.

### 🔧 Changed

- Improved agent session readability with clearer compact tool rows, expandable collapsed work, better stream hints, and more stable scrolling during long runs.
- Made large sessions open faster by deferring non-agent hydration, paginating persisted agent state, and adding database indexes for agent message history.
- Made large workspaces easier to browse by reducing file-tree jank and avoiding eager rendering of ignored directory contents.
- Improved editor polish around active tabs, selection highlights, status indicators, prompt-panel height, and sidebar resizing.
- Made LSP downloads and discovery more reliable by filtering proxy shims, streaming downloads with a User-Agent, and routing server messages to user-visible toasts.

### 🐛 Fixed

- Fixed prompt drafts leaking across conversation switches and cleared stale prompt text when switching away from an uninitialized conversation.
- Fixed inline diff expansion so one file's expanded state no longer affects another file.
- Fixed archive confirmation double-submit behavior so the modal cannot accidentally target the next feature.
- Fixed file-tree folder actions, manual feature rename visibility, active-agent card shadows, and collapsed edit/write rows.
- Fixed editor issues around Cmd+Z immediately after opening a file, stale dirty state when reopening files, active-line selection visibility, and blame refresh after editor mount.
- Fixed merge conflict handling so the merge dialog surfaces conflicts explicitly instead of failing silently.
- Fixed shortcuts-help opening across QWERTY and AZERTY keyboard layouts.

### 🔒 Security

- Added SHA-256 verification for managed LSP downloads before Cadencr runs the downloaded binary.

## v0.2.2 - 2026-05-20

Previous release: v0.2.1 - 2026-05-20

### 🔧 Changed

- Removed the `Cmd+D` editor split shortcuts to avoid conflicts with normal editor selection workflows.

### 🐛 Fixed

- Fixed image-only prompts so provider conversations can start with screenshots or visual context without requiring extra text.
- Fixed multi-file patch rendering so changed files display reliably in patch views.
- Fixed sidebar toggles so editor buffers stay open while resizing or hiding the sidebar.
- Fixed agent session state so working status appears before runtime startup work begins.
- Fixed app visibility restores so existing agents are not reconnected unnecessarily.
- Fixed GitHub Copilot model routing through OpenCode-backed sessions.

### 🔒 Security

- Updated OpenSSL dependencies to include the latest patched `0.10.x` release.

## v0.2.1 - 2026-05-20

Previous release: v0.2.0

### ✨ Added

- Added clearer task tracking in agent sessions, so Claude task updates can appear as structured todos instead of being buried in tool output.

### 🔧 Changed

- Made keyboard shortcuts more reliable across keyboard layouts and prevented native zoom shortcuts from fighting the app's saved zoom preference.
- Made reconnect behavior more aggressive and surfaced offline status more clearly when the local backend disconnects.
- Improved diff navigation by opening changed files at the first edited line and making edit actions less visually heavy.

### 🐛 Fixed

- Fixed prompt drafts leaking between conversations.
- Fixed prompt receipt timing for Codex steering messages and Claude Code steering prompts by using replayed user messages, reducing confusing pending/sent states.
- Fixed landing-page SEO indexing and mobile horizontal scrolling issues.

## v0.2.0 - 2026-05-18

Previous release: v0.1.3 (df0a9d0038c7869d9b04199d2f78bb5f3dc3ac67)

### Added

- Added archive cleanup controls for safely removing feature worktrees and deleting feature branches, including dirty-worktree and unmerged-branch warnings.
- Added reusable patch diff rendering for inline edit diffs and the Git tab.
- Added Codex steering prompt receipt support and keyboard-layout-aware shortcut handling.

### Changed

- Refined the sidebar and unified agent UI with clearer shortcut badges, portal hover tooltips, persistent row heights, and improved session timing state.
- Persisted project worktree defaults for smoother feature setup.
- Trimmed tool-call paths and Bash commands relative to the working directory for more readable agent output.

### Fixed

- Kept new sessions idle until the first prompt is sent.
- Kept working-directory queries alive for unfocused unified-grid agents.
- Passed response instructions through the OpenCode ACP adapter.

## v0.1.3 - 2026-05-17

Previous release: v0.1.2 (42c9183a091f1e37e5fc40c4dc8d31a6e1977bf9)

### Added

- Added a dedicated download page that recommends the right macOS build when the browser exposes platform details.
- Added direct manual download targets for macOS DMG and ZIP artifacts.

### Changed

- Updated landing page download CTAs to point to the dedicated download page.
- Derived the landing site version and release asset URLs from package metadata.
- Replaced the desktop update notification toast with a sidebar update pill and post-update changelog dialog.

### Fixed

- Fixed GitHub release CTA icon sizing and visual alignment in the recommended download card.
- Kept download asset sizes on one line in the manual target list.
- Themed Sonner toast variants with desktop design tokens.

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
