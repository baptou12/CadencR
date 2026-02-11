---
description: Generate a sandbox Dockerfile for autonomous ralph loop execution
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

## Context

Read `.simplan/config` for settings (key=value format). Relevant setting:
- `commit_plan=true` - Required for sandbox mode (the container clones from remote)

## Task

Generate a `.simplan/sandbox.Dockerfile` for running the ralph loop autonomously inside a Docker container.

### Steps

1. **Check `commit_plan` gate**:
   - Read `.simplan/config`. If `commit_plan=true` is NOT set, stop with this error:

   > Sandbox mode requires `commit_plan=true` in `.simplan/config`.
   >
   > The container clones from remote, so your plan files must be committed and pushed to be available inside the sandbox.
   >
   > Run: `echo 'commit_plan=true' >> .simplan/config`

2. **Check for existing Dockerfile**:
   - If `.simplan/sandbox.Dockerfile` already exists, use **AskUserQuestion**:
     - "A sandbox Dockerfile already exists. What would you like to do?"
       - "Troubleshoot issues" (description: "I'll build the existing Dockerfile, run the verification checks, and help you fix any problems.")
       - "Regenerate from scratch" (description: "Discard the current Dockerfile and re-detect everything.")
       - "Keep as-is" (description: "No changes needed.")
   - If **"Keep as-is"**: stop
   - If **"Regenerate"**: continue to step 3
   - If **"Troubleshoot"**: jump to the **Troubleshoot flow** below, skip steps 3–5

### Troubleshoot flow

When the user has an existing Dockerfile and wants to fix it:

1. **Read the existing `.simplan/sandbox.Dockerfile`** to understand what's currently in it.

2. **Build and run all verification checks** (same as step 6 in the normal flow — build image, start temp container, check git, clone, runtime, Claude CLI).

3. **Collect all failures** into a list. For each failure, note:
   - Which check failed
   - The exact error output
   - Your diagnosis of the likely cause

4. If **no failures**: report that everything passed and stop.

5. If **there are failures**: present them to the user and ask targeted questions to resolve each one. Use **AskUserQuestion** for each distinct issue category:

   **Build failures:**
   - Read the build error output carefully. Common causes:
     - Missing base image → ask if they want to change it
     - Failed `apt-get install` → package name may be wrong or unavailable, suggest correct package
     - `npm install -g` failures → network or Node version issue
   - Show the error and your suggested fix. Ask: "Should I apply this fix to the Dockerfile?"

   **Git/clone failures:**
   - SSH key not available in container → suggest mounting SSH keys or switching to HTTPS
   - Ask: "How does your repo authenticate?" with options:
     - "SSH keys (mount ~/.ssh)" (description: "I'll add a volume mount for SSH keys")
     - "HTTPS with token" (description: "I'll configure git credential helper")
     - "The repo is public" (description: "Clone should work without auth — let me investigate further")

   **Runtime/tool failures:**
   - Missing system library → identify which package provides it and add to Dockerfile
   - Wrong version → ask if they want to pin a specific version
   - Show the error and suggested `apt-get install` addition

   **Claude CLI failures:**
   - Auth issue → explain that `~/.claude` must contain valid credentials and be mounted
   - Binary not found → Node.js or npm may not be installed correctly
   - Ask: "Can you run `claude -p "hi"` on your host successfully?" to isolate auth vs install issues

6. **Apply fixes**: After collecting answers, edit `.simplan/sandbox.Dockerfile` with the fixes.

7. **Re-run verification** (build + all checks) to confirm the fixes worked. If new failures appear, repeat the troubleshoot loop (up to 3 attempts). After 3 attempts, show remaining issues and let the user decide.

8. **Show result** with the same verification summary as the normal flow (step 7).

---

*Continue here for the normal (non-troubleshoot) flow:*

3. **Explore the codebase** to understand what the container needs:

   **a) Detect primary stack** — look for manifest files in the project root:
   - `package.json` → Node.js (use `node:20-slim`)
   - `Cargo.toml` → Rust (use `rust:latest`)
   - `go.mod` → Go (use `golang:latest`)
   - `requirements.txt` or `pyproject.toml` or `Pipfile` → Python (use `python:3.12-slim`)
   - `Gemfile` → Ruby (use `ruby:latest`)
   - If none found → use `debian:bookworm-slim`
   - If multiple are found, pick the most prominent one (prefer package.json for monorepos)

   **b) Discover runtime dependencies** — read the manifest files and explore the codebase:
   - **package.json**: Read `scripts` to find what CLI tools are invoked (e.g., `tsc`, `eslint`, `vitest`, `playwright`, `prisma`). Check `engines` for Node version requirements. Check `devDependencies` for tools that need system-level support (e.g., `sharp` needs `libvips`, `canvas` needs `libcairo`, `bcrypt` needs `build-essential`)
   - **Cargo.toml**: Check for crates needing system libraries (e.g., `openssl-sys` → `libssl-dev pkg-config`, `diesel` with postgres → `libpq-dev`)
   - **go.mod**: Check for CGO dependencies, look for C imports in `.go` files
   - **requirements.txt / pyproject.toml**: Look for packages needing native deps (e.g., `psycopg2` → `libpq-dev`, `Pillow` → `libjpeg-dev libpng-dev`, `lxml` → `libxml2-dev libxslt-dev`)
   - **Gemfile**: Check for native extensions (e.g., `pg` → `libpq-dev`, `nokogiri` → `libxml2-dev`)

   **c) Check for tool configuration** — look for config files that imply required tools:
   - `.eslintrc*`, `eslint.config.*` → ESLint (typically in devDependencies, but confirms it's used)
   - `tsconfig.json` → TypeScript
   - `Makefile` → `make` and `build-essential`
   - `docker-compose*.yml` → project may need docker-in-docker or service access (warn user)
   - `.tool-versions`, `.nvmrc`, `.node-version`, `.python-version`, `.ruby-version` → specific runtime versions (use these instead of defaults)
   - `playwright.config.*` or `cypress.config.*` → browser testing (needs additional system deps — warn user these are heavy)

   **d) Check for database/service dependencies** — scan config files and source for:
   - Database connection strings or ORM configs (e.g., `DATABASE_URL`, `prisma/schema.prisma`, `knexfile`, `ormconfig`) → warn user they'll need to provide database access or mock it
   - Redis, Elasticsearch, or other service references → warn user about service dependencies

   **e) Check build scripts and CI** — look at:
   - `Makefile` targets for what commands the project uses
   - `.github/workflows/*.yml` or `.gitlab-ci.yml` — CI files often list the exact system packages needed. Extract `apt-get install` or `brew install` lines as hints
   - `scripts/` directory for shell scripts that invoke system tools

4. **Present findings and ask for confirmation**:
   - Summarize what you found: base image, detected tools, inferred system packages, and any warnings (e.g., "This project uses Playwright — browser deps are large, consider skipping if not needed for your task")
   - Use **AskUserQuestion**: "Should I include all detected dependencies, or do you want to customize?" with options:
     - "Include all detected dependencies" (recommended)
     - "Let me customize the list"
     - "Minimal — just the base stack and Claude Code"
   - If customize: show the full list and let user specify which to keep and any additions

5. **Generate `.simplan/sandbox.Dockerfile`**:

   The Dockerfile should include:
   - Appropriate base image (respecting version files like `.nvmrc` or `.python-version` if found)
   - `git` and `openssh-client` installed
   - All detected system packages from step 3
   - Claude Code CLI: `npm install -g @anthropic-ai/claude-code`
     - For non-Node images, install Node.js first (via NodeSource or similar)
   - Language-specific dependency installation (e.g., `COPY package*.json . && npm install` for Node, `COPY requirements.txt . && pip install -r requirements.txt` for Python)
   - Non-root user `sandboxuser` with a home directory
   - `USER sandboxuser`
   - `WORKDIR /workspace`
   - Comments explaining why each package is included (e.g., `# sharp requires libvips`)

   **Example for a Node.js project with TypeScript, Prisma, and sharp:**
   ```dockerfile
   FROM node:20-slim

   RUN apt-get update && apt-get install -y \
       git \
       openssh-client \
       build-essential \        # native module compilation
       libvips-dev \            # required by sharp
       openssl \                # required by prisma
     && rm -rf /var/lib/apt/lists/*

   RUN npm install -g @anthropic-ai/claude-code

   RUN useradd -m -s /bin/bash sandboxuser
   USER sandboxuser
   WORKDIR /workspace
   ```

   **Example for a Python project with psycopg2 and Pillow:**
   ```dockerfile
   FROM python:3.12-slim

   RUN apt-get update && apt-get install -y \
       git \
       openssh-client \
       curl \
       build-essential \        # native extension compilation
       libpq-dev \              # required by psycopg2
       libjpeg-dev libpng-dev \ # required by Pillow
     && rm -rf /var/lib/apt/lists/*

   # Install Node.js for Claude Code CLI
   RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
     && apt-get install -y nodejs \
     && rm -rf /var/lib/apt/lists/*

   RUN npm install -g @anthropic-ai/claude-code

   RUN useradd -m -s /bin/bash sandboxuser
   USER sandboxuser
   WORKDIR /workspace
   ```

6. **Build and verify the sandbox**:

   Build the image and run validation checks inside a temporary container. Stop and report clearly if any check fails.

   ```bash
   # Build the image
   docker build -t simplan-sandbox -f .simplan/sandbox.Dockerfile .
   ```

   If the build fails, read the error, fix the Dockerfile, and retry. Do not proceed until the build succeeds.

   Then run verification checks inside a temporary container:

   ```bash
   # Start a temporary container with claude auth mounted
   docker run -d --name simplan-sandbox-test \
     -v "$HOME/.claude:/home/sandboxuser/.claude:ro" \
     simplan-sandbox tail -f /dev/null
   ```

   **a) Check git works:**
   ```bash
   docker exec simplan-sandbox-test git --version
   ```

   **b) Check repo can be cloned** — use the current project's remote:
   ```bash
   REMOTE_URL=$(git remote get-url origin)
   CURRENT_BRANCH=$(git branch --show-current)
   docker exec simplan-sandbox-test git clone --branch "$CURRENT_BRANCH" "$REMOTE_URL" /workspace/test-repo
   ```
   If clone fails (e.g., SSH keys not available), try HTTPS. Warn the user about auth if both fail, but don't block — the Dockerfile itself is still valid.

   **c) Check project-specific tools** — run inside the cloned repo:
   - For Node.js: `docker exec -w /workspace/test-repo simplan-sandbox-test node --version && npm --version`
   - For Python: `docker exec -w /workspace/test-repo simplan-sandbox-test python --version && pip --version`
   - For Rust: `docker exec -w /workspace/test-repo simplan-sandbox-test rustc --version && cargo --version`
   - For Go: `docker exec -w /workspace/test-repo simplan-sandbox-test go version`
   - For Ruby: `docker exec -w /workspace/test-repo simplan-sandbox-test ruby --version && bundle --version`

   **d) Check Claude Code CLI is invokable:**
   ```bash
   docker exec simplan-sandbox-test claude -p "Say hi" --max-turns 1 2>&1
   ```
   This must produce a response (not an error). If it fails due to auth, warn the user that `~/.claude` may not contain valid credentials, but don't block.

   **e) Clean up the test container:**
   ```bash
   docker rm -f simplan-sandbox-test 2>/dev/null
   ```

   If any critical check fails (build, git, language runtime), fix the Dockerfile and re-run the checks. Auth-related failures (clone, claude) are warnings, not blockers.

7. **Show result**:

   > Sandbox Dockerfile generated and verified!
   >
   > ```
   > .simplan/sandbox.Dockerfile
   > ```
   >
   > **Base image**: `<image>`
   > **Stack detected**: `<stack>`
   > **System packages**: `<list of packages and why>`
   > **Warnings**: `<any service dependencies or heavy deps noted>`
   >
   > **Verification results:**
   > - Build: ✅
   > - Git: ✅
   > - Repo clone: ✅ / ⚠️ (auth issue — check SSH keys or use HTTPS)
   > - Runtime (<language>): ✅
   > - Claude Code CLI: ✅ / ⚠️ (auth issue — ensure ~/.claude has valid credentials)
   >
   > To use with ralph loop:
   > ```bash
   > /item:ralph <slug>
   > ```
   > Then select "Sandbox (autonomous)" mode.
