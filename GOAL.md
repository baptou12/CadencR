# Cadencr — Desktop IDE for AI coding agents

## Vision

A desktop application that provides a fully-fledged UI for local AI coding agents (Claude Code, OpenCode, and more), replacing the terminal-based workflow with a structured project management experience. The app manages codebases as projects, breaks work into features, and orchestrates dedicated AI agents for planning, execution, risk analysis, and code review.

## Problems Solved

- **Diff readability**: Terminal diffs are hard to parse. Cadencr provides a visual diff viewer with inline commenting.
- **Parallel execution**: Running multiple Claude Code instances on the same project is fragile. The app manages concurrent agents with proper coordination.
- **Task planning**: No structured way to plan, track, and review features. The app provides a full feature lifecycle (plan → execute → review → test).
- **Command management**: Repetitive prompt engineering for common tasks. Dedicated agents handle specific concerns (planning, coding, risk analysis).
- **Output readability**: Terminal output is noisy and hard to navigate. The UI presents agent output in a clean, structured format.

## Core Features

1. **Project Management** — A project = a codebase. Open, switch, and manage multiple projects.
2. **Feature Sidebar** — List of features per project with status tracking (draft, planned, in-progress, review, done).
3. **Feature Page** — Main workspace to interact with a feature through its lifecycle via specialized agents.
4. **Dedicated Agents**:
   - **Plan Agent** — Explores the codebase, asks clarifying questions via dynamic forms, produces a phased plan.
   - **Execute Agent** — Takes plan phases, respects parallelism constraints, executes code changes.
   - **Risk Analysis Agent** — Analyzes a plan's impact on the codebase before execution.
   - **Review Agent** — Post-execution review and validation.
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
