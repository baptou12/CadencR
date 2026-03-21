---
name: commit
description: Commit current session changes with pre-commit checks, test verification, and safe git practices
user-invocable: true
disable-model-invocation: true
allowed-tools: Bash(pnpm *), Bash(cargo *), Read, Grep, Glob
---

# Commit Changes

Commit the changes made during the current session. Follow these rules strictly.

## 1. Identify session changes only

Run `git diff` and `git status` to see all modified and untracked files. **Only stage files that were changed as part of the current session.** If there are unknown or unrelated changes (files you didn't touch in this session), leave them alone — do NOT stage, stash, or revert them.

## 2. Never use `git stash`

Do NOT run `git stash` at any point during the commit process unless the user explicitly asks for it.

## 3. Verify test coverage

Before committing, check whether the changes have adequate test coverage:

- Look for new or modified functions/components and check if corresponding tests exist.
- If tests are missing, **stop and ask the user** whether to write tests first or commit without them.
- If tests exist, run them (`pnpm test` or `cargo test` as appropriate) and ensure they pass.

## 4. Never use `--no-verify`

All commits MUST run pre-commit hooks. Do NOT use `--no-verify` or `--no-gpg-sign` unless the user explicitly asks to skip hooks. If a pre-commit hook fails, fix the issue and retry — do not bypass it.

## 5. Create the commit

- Stage only the session's changed files by name (no `git add -A` or `git add .`).
- Write a concise commit message that describes the "why", not just the "what".
- Use a HEREDOC for the commit message to ensure proper formatting.
- Do NOT push unless the user explicitly asks.

## 6. Verify

Run `git status` after committing to confirm success.
