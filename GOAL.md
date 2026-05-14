# Cadencr — Desktop IDE for AI coding agents

## Vision

A desktop application that provides a fully-fledged UI for local AI coding agents (Claude Code, OpenCode, and more), replacing the terminal-based workflow with a structured project management experience. The app manages codebases as projects, breaks work into features, and runs each feature in its own worktree-backed agent session.

## Problems Solved

- **Diff readability**: Terminal diffs are hard to parse. Cadencr provides a visual diff viewer with inline commenting.
- **Parallel execution**: Running multiple Claude Code instances on the same project is fragile. The app manages concurrent agents with proper coordination.
- **Worktree isolation**: Each feature gets its own branch + worktree so parallel sessions can't trample each other.
- **Output readability**: Terminal output is noisy and hard to navigate. The UI presents agent output in a clean, structured format.

## Core Features

1. **Project Management** — A project = a codebase. Open, switch, and manage multiple projects.
2. **Feature Sidebar** — List of features per project. Each feature owns a worktree, an agent session, and its own conversation history.
3. **Feature Page** — Splittable workspace combining the agent session, diff viewer, terminal, and editor tabs.
4. **Agent Session** — A long-lived WebSocket-driven conversation with the chosen provider (Claude Code, OpenCode, Codex) per feature.
5. **Diff Viewer** — Visual diff for worktree changes or branch comparisons, with per-line commenting for modification requests.

## Tech Stack

| Layer           | Technology                              |
| --------------- | --------------------------------------- |
| Desktop shell   | Electron + React                         |
| Backend service | Rust (Axum, Tokio) — spawned as sidecar |
| UI framework    | React 19                                |
| Styling         | Tailwind CSS + shadcn/ui                |
| AI backbone     | Claude Code & OpenCode (CLI / SDK)      |
| Local storage   | SQLite (via `sqlx`)                     |
