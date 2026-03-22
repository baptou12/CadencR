---
name: test-commit
description: Write tests for current session changes, then commit everything with pre-commit checks and safe git practices
user-invocable: true
disable-model-invocation: false
allowed-tools: Bash(pnpm *), Bash(cargo *), Read, Grep, Glob, Edit, Write, Agent
---

# Test & Commit Changes

Write tests for changes made during the current session, then commit. Follow these rules strictly.

## 1. Identify session changes only

Run `git diff` and `git status` to see all modified and untracked files. **Only consider files that were changed as part of the current session.** If there are unknown or unrelated changes (files you didn't touch in this session), leave them alone — do NOT stage, stash, or revert them.

## 2. Write tests first

Before committing, write tests for the session's changes:

- Identify new or modified functions/components that lack test coverage.
- Write tests for them using the project's existing test patterns (`vitest` for TS, `cargo test` for Rust).
- Run the tests (`pnpm test` or `cargo test` as appropriate) and ensure they pass.
- For Rust tests: search the output for the `FAILED` keyword — `cargo test` exits 0 for compilation success even when tests fail. Always check for `FAILED` in the output to catch test failures.
- If all changes already have adequate test coverage, skip to step 4.

## 3. Never use `git stash`

Do NOT run `git stash` at any point during the commit process unless the user explicitly asks for it.

## 4. Never use `--no-verify`

All commits MUST run pre-commit hooks. Do NOT use `--no-verify` or `--no-gpg-sign` unless the user explicitly asks to skip hooks. If a pre-commit hook fails, fix the issue and retry — do not bypass it.

## 5. Create the commit

- Stage only the session's changed files by name (no `git add -A` or `git add .`), including any new test files.
- Write a concise commit message that describes the "why", not just the "what".
- Use a HEREDOC for the commit message to ensure proper formatting.
- Do NOT push unless the user explicitly asks.

## 6. Verify

Run `git status` after committing to confirm success.
