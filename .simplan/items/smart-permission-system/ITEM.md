# Smart permission system for agent tool calls
- **Type**: ✨ Feature
- **Status**: 📋 PLANNED
- **Description**: Replace `bypassPermissions` mode with a smart `canUseTool`-based permission system. Auto-allow all tool operations inside the worktree and `/tmp`. Prompt the user for any tool accessing paths outside the worktree, and always prompt for `git push`. Use the SDK's `settingSources` to load `.claude/settings.json` files. When user approves "allow for future use", write the pattern to `<worktree>/.claude/settings.local.json`. Show permission prompts inline in the UI with CMD+number shortcuts.
