---
description: Update simplan framework and initialize .simplan/
argument-hint:
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Edit
  - WebFetch
  - AskUserQuestion
---

## Task

You are updating the simplan framework. Follow these steps in order:

### Step 1: Detect Installation Mode and Platform

Check for version files to determine installation type and platform:

**Claude Code:**
- `${XDG_CONFIG_HOME:-$HOME/.config}/simplan-source/.version` → Global installation
- `.claude/.simplan-version` → Local installation

**OpenCode:**
- `${XDG_CONFIG_HOME:-$HOME/.config}/simplan-source/.version` → Global installation
- `.opencode/.simplan-version` → Local installation

Read the version file to get current installed version.

If neither exists, inform the user that simplan is not installed and provide installation instructions:
```
curl -fsSL https://raw.githubusercontent.com/rle-mino/simplan/main/install.sh | bash
# OR for global install:
curl -fsSL https://raw.githubusercontent.com/rle-mino/simplan/main/install.sh | bash -s -- --global
```

### Step 2: Fetch Latest Version Info

Fetch from GitHub:
- VERSION file: https://raw.githubusercontent.com/rle-mino/simplan/main/VERSION
- CHANGELOG.md: https://raw.githubusercontent.com/rle-mino/simplan/main/CHANGELOG.md

Compare versions. If already up-to-date, inform user and proceed to Step 4 (skip Step 3).

Otherwise, display the changelog to the user:

1. **Extract relevant entries**: Parse CHANGELOG.md and show all version entries between the current installed version and the latest version (inclusive of latest, exclusive of current)

2. **Format the changelog clearly**:
   ```
   ## What's New in v<latest>

   <For each version from latest down to current+1>

   ### v<version> - <date>

   <List all Added/Changed/Fixed items with brief explanations>
   ```

3. **Explain behavioral changes**: For each significant change, provide a brief explanation of what it means for the user. Examples:
   - "**`commit_plan` config option**: You can now optionally commit your `.simplan/` files alongside code changes. When enabled, simplan will ask before committing plan updates."
   - "**`item:exec` no longer auto-chains**: After completing a phase, you'll now be prompted to run `/item:exec` again instead of automatically continuing. This gives you more control over the workflow."

4. **Highlight new configuration options**: If new config options were added, note them separately:
   ```
   ## New Configuration Options

   The following new settings are available in `.simplan/config`:
   - `commit_plan` - Commit plan files with code changes (see Step 6)
   ```

### Step 3: Run Update

Ask user for confirmation before updating using AskUserQuestion.

Execute the appropriate install command:
- Global: `curl -fsSL https://raw.githubusercontent.com/rle-mino/simplan/main/install.sh | bash -s -- --global`
- Local: `curl -fsSL https://raw.githubusercontent.com/rle-mino/simplan/main/install.sh | bash`

Report the update result. The installer will automatically clean up deprecated files.

### Step 4: Migrate from Old Structure (ALWAYS run this step)

**This step MUST always run**, even if the version is already up-to-date. It checks whether the `.simplan/` data needs migration.

Check if `.simplan/ITEMS.md` exists. If it does NOT exist, skip to Step 5.

If `.simplan/ITEMS.md` exists, this is an **old-format project** that needs migration to the new per-item folder structure.

**Migration process:**

1. **Inform the user**: "Your project uses the old ITEMS.md format. I'll migrate to the new per-item folder structure."

2. **Read `.simplan/ITEMS.md`** and parse all items. Each item section looks like:
   ```markdown
   ## Item #<number>: <title>
   - **Type**: <emoji> <type>
   - **Status**: <emoji> <status>
   - **Description**: <description>
   - **Slug**: <slug>
   - **Plan**: <plan-path or None>
   ```

3. **For each item**, create `.simplan/items/<slug>/ITEM.md`:
   ```markdown
   # <title>
   - **Type**: <emoji> <type>
   - **Status**: <emoji> <status>
   - **Description**: <description>
   ```

4. **Migrate plans**: For each item that has a plan path (not "None"):
   - If the plan is a single file (e.g., `.simplan/plans/<number>-<slug>.md`):
     - Read it, replace the header `# Plan: Item #<number> - <title>` with `# Plan: <title>`, and write it to `.simplan/items/<slug>/PLAN.md`
   - If the plan is a folder (e.g., `.simplan/plans/<number>-<slug>/`):
     - Read `README.md`, update the header similarly, and write it to `.simplan/items/<slug>/PLAN.md`
     - Copy any other files (brainstorm.md, phase-N.md, etc.) to `.simplan/items/<slug>/`

5. **Clean up old structure**:
   - Ask user for confirmation before deleting old files (use AskUserQuestion)
   - If confirmed:
     - Delete `.simplan/ITEMS.md`
     - Delete `.simplan/plans/` directory
   - If not confirmed, leave old files in place alongside new structure

6. **Report migration results**: List items migrated and any issues encountered.

### Step 5: Initialize .simplan/ (if needed)

If no `.simplan/` folder exists in the current project:
- Ask user if they want to initialize it using AskUserQuestion
- If confirmed, create:
  - `.simplan/items/` directory

If `.simplan/` exists but `.simplan/items/` does not, create it.

### Step 6: Configure New Options

Check if `.simplan/config` exists. Parse it as key=value format (one per line).

For each configuration option that was introduced in versions between the user's previous version and the latest version, ask the user if they want to configure it.

**Available configuration options:**

#### `commit_plan` (added in v1.6.0)

Ask using AskUserQuestion:
- **Header**: "Commit plans?"
- **Question**: "Do you want simplan to commit `.simplan/` files alongside your code changes?"
- **Options**:
  1. **"Yes"** - Description: "Plan files will be committed with code. You'll be asked to confirm each commit. Requires removing `.simplan/` from `.gitignore`."
  2. **"No (default)"** - Description: "Plan files stay local and gitignored. Plans are personal working notes, not shared documentation."

If user selects "Yes":
1. Create or update `.simplan/config` with `commit_plan=true`
2. Check if `.gitignore` contains `.simplan/` - if so, inform the user:
   > **Note**: You'll need to remove `.simplan/` from your `.gitignore` to enable plan commits.
   > You can do this manually or I can do it for you.
   Ask with AskUserQuestion (Header: "Update .gitignore?", Options: "Yes, remove .simplan/" / "No, I'll do it manually")

If user selects "No" or skips:
- Do not modify `.simplan/config` for this option (default behavior is to not commit plans)

### Step 7: Report Summary

Provide a summary:
- Framework version: X.X.X → Y.Y.Y (or "already up-to-date")
- .simplan/ initialized (if created)
- Migration completed (if migrated from old format)
- Configuration changes (if any options were set)
- Any deprecated files that were cleaned up (reported by installer)

---

## Next Steps

Tell the user:

> Simplan is up to date (<version>)!

If framework files were updated (Step 3 ran), also tell the user:

> To load the new commands, restart Claude Code:
> `/exit` then reopen
