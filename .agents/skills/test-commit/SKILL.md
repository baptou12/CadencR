---
name: test-commit
description: Write tests for current session changes, then commit everything with pre-commit checks and safe git practices
---

# Test & Commit Changes

Write tests for changes made during the current session, then commit.

## 1. Identify session changes only

Run `git diff` and `git status` to see all modified and untracked files. Only consider files changed as part of the current session. If there are unrelated changes, leave them alone. Do not stage, stash, or revert them.

## 2. Write tests first

Before committing:

- Identify new or modified functions and components that lack test coverage.
- Write tests using the project's existing patterns: `vitest` for TypeScript and `cargo test` for Rust.
- Run the relevant tests and ensure they pass.
- For Rust tests, search the output for `FAILED` rather than trusting exit status alone.
- If coverage is already adequate, continue.

## 3. Never use `git stash`

Do not run `git stash` unless the user explicitly asks for it.

## 4. Never use `--no-verify`

All commits must run pre-commit hooks. Do not use `--no-verify` or `--no-gpg-sign` unless the user explicitly asks to skip hooks.

## 5. Create the commit

- Stage only the session's changed files by name.
- Write a concise commit message that explains why.
- Use a heredoc for multi-line commit messages.
- Do not push unless the user explicitly asks.

## 6. Verify

Run `git status` after committing to confirm success.
