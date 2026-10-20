---
name: release
description: Prepare and publish a Cadencr release from a version tag such as v0.2.0.
argument-hint: vX.Y.Z
user-invocable: true
allowed-tools: Bash(git *) Bash(gh *) Bash(pnpm *) Bash(cargo *) Bash(./scripts/release.sh *) Bash(scripts/release.sh *) Read Grep Glob Edit Write Agent
---

# Release Command

Prepare and publish a Cadencr release.

Arguments: `$ARGUMENTS` must be exactly one semantic version tag in the form `vX.Y.Z`, for example `v0.2.0`.

## Critical safety rule

After `git push origin vX.Y.Z`, the GitHub release workflow starts and the version is considered consumed. If the tag or release must be deleted afterward, do **not** reuse the same version. Increment the version counters and release a new tag.

The helper script creates the local tag only. The agent must push the tag explicitly after all checks pass.

## Required flow

1. **Validate the requested tag**
   - Reject missing or malformed arguments.
   - Use `TAG="$ARGUMENTS"` and `VERSION="${TAG#v}"`.

2. **Inspect the release range**
   - Fetch tags: `git fetch --tags origin`.
   - Find the latest previous release tag: `git tag --list 'v[0-9]*' --sort=-v:refname | head -1`.
   - Summarize commits with `git log --oneline "$PREVIOUS_TAG..HEAD"`.
   - You may inspect the previous tag commit hash internally when useful for validation, but do not include it in published release notes or the final user-facing summary.

3. **Generate release notes and changelog**
   - Update `CHANGELOG.md` with a section for the requested tag.
   - Include the previous tag version and release date; do not include the previous tag commit hash.
   - Write the changelog around user impact: what changed for users, what got better, and what was fixed.
   - Use emoji-prefixed changelog section headings for standard groups, such as `### ✨ Added`, `### 🔧 Changed`, and `### 🐛 Fixed`.
   - Inspect the relevant commit diffs, linked GitHub issues, and linked PRs before wording each changelog line; avoid vague summaries that hide the actual user-facing issue.
   - Use one changelog bullet per new user-facing feature, even if that feature was merged, fixed, polished, or refactored multiple times before the release. Fold those pre-release fixes into the single feature bullet instead of listing them again as separate `Fixed` bullets.
   - New feature bullets may use longer descriptions when needed to explain the shipped capability clearly. Prefer one rich, publish-ready feature line over several short bullets for the same feature.
   - Reserve separate `Fixed` bullets for independent bug fixes or regressions that are not merely pre-release follow-up work for a newly added feature.
   - Prefix every changelog bullet with one existing GitHub label scope in bold square-bracket form, for example `[**Desktop**]`, `[**Backend**]`, `[**provider:codex**]`, or `[**provider:claude**]`.
   - Prefer the label scope from the linked issue or PR. If multiple labels apply, choose the most user-relevant area/provider label. If no issue or PR is linked, use `gh label list` and the affected files to choose an existing label; do not invent new scope names.
   - Keep each feature and fix bullet focused on user impact, then end that same bullet with `— [@handle](https://github.com/handle).` for every human contributor who materially authored the item. Do not add wording such as `contributed by`. Credit each contributor once per changelog line; exclude bots, merge-only identities, and the release-preparation commit author.
   - When one changelog line folds together work from multiple PRs or commits, include every applicable contributor on that line using linked GitHub handles when available.
   - Keep the changelog factual and concise.
   - Images are optional. Add one when it helps communicate the release or explain a user-facing change, and follow [Changelog images](#changelog-images-optional). For an announcement graphic, also follow [Landing news visuals](#landing-news-visuals).
   - The GitHub release page is populated automatically from this exact changelog section by the release workflow, so write it as publish-ready release notes.

4. **Ask for landing news copy**
   - Ask the developer whether this release needs a landing news post and, if yes, what marketing/commercial text they want to show in addition to the changelog.
   - Do not invent the main marketing angle without developer input.
   - If the developer requests no news post, continue with changelog-only release notes and do not create a landing news file.
   - If the developer provides news copy, create a post under `packages/landing/src/content/news/` whose filename includes the release version, for example `cadencr-v0-2-0.mdx`.
   - The post should sell the release clearly while remaining accurate.
   - When the developer requests visuals, follow [Landing news visuals](#landing-news-visuals): use an abstract announcement graphic for the opening and authentic app screenshots to illustrate features in the article.
   - Write the news post from the perspective that the release has already shipped. Use present or past release language such as `is available now` and link directly to the release. Never use staging language such as `once the release is live`, `will be available`, or `once publication finishes`.
   - Stop after `CHANGELOG.md` and any requested landing news post are modified. Show the drafted changelog section and news file path or changelog-only status, then ask the developer to confirm before continuing.
   - Wait for explicit developer confirmation before continuing to version bumps, security review, CI checks, release preparation commit, preflight, tagging, pushing, or asset polling.

5. **Update every application version**
   - Update package versions in package manifests under `packages/*/package.json` that already have a version field.
   - Update Rust package versions in `packages/*/Cargo.toml` that already have a package version.
   - Update lockfiles when the package manager requires it.
   - Keep `SDK_VERSION` in `packages/tab-sdk/src/version.ts` equal to `packages/tab-sdk/package.json`; custom tabs send this value in their handshake.
   - Do not change unrelated dependency versions.
   - Verify the landing page displays the new version from `packages/landing/package.json` rather than a hardcoded version string.
   - If the landing source still contains hardcoded version labels for the navbar, footer, hero, download blocks, or release CTAs, replace them with the shared landing version source and include that in the release preparation commit.

6. **Run a dedicated security and regression review**
   - If subagents are available, launch a dedicated review agent focused only on security and regressions introduced since the previous tag.
   - Ask it to inspect the diff from `PREVIOUS_TAG..HEAD`, with special attention to secrets, release signing, updater behavior, migrations, data loss, authentication/authorization, command execution, and provider boundary regressions.
   - If subagents are unavailable, perform the same review yourself and document the result.
   - Fix or explicitly escalate every serious finding before continuing.

7. **Check the latest main CI status**
   - The release workflow itself should not introduce application code changes, and pre-commit hooks will catch broken release-prep edits.
   - Instead of rerunning the full local test suite, verify that the latest `main` commit is green before releasing:

```bash
git fetch origin main
MAIN_SHA="$(git rev-parse origin/main)"
gh api "repos/{owner}/{repo}/commits/$MAIN_SHA/check-runs" \
  --jq '.check_runs[] | [.name, .status, .conclusion] | @tsv'
gh api "repos/{owner}/{repo}/commits/$MAIN_SHA/status" \
  --jq '{state: .state, statuses: [.statuses[] | {context, state}]}'
```

- Continue only if the latest `origin/main` checks are completed and successful, or if the developer explicitly accepts releasing from a non-green main.

8. **Create the release preparation commit**
   - Review the final diff and ensure it contains only release preparation changes.
   - Commit the changelog, optional landing news, version bumps, and lockfile updates before tagging.
   - Use a concise commit message such as `chore: prepare release vX.Y.Z`.
   - The helper script requires a clean worktree so the local tag points at the committed release state.

9. **Run the automated release preflight**
   - Run: `scripts/release.sh "$TAG"`.
   - This checks that the changelog section can be extracted for GitHub release notes, plus optional news/version files, tag and release availability, and trufflehog results.
   - It creates the local annotated tag when all checks pass.
   - If it fails, fix the reported issue and rerun it.

10. **Push the tag manually**

- Show the critical safety rule again.
- Run: `git push origin "$TAG"`.
- The script must not do this step.

11. **Poll GitHub for release assets**
    - Poll until the release exists, is not a draft, and has assets.
    - Use a bounded loop like:

```bash
for i in $(seq 1 120); do
  gh release view "$TAG" --json isDraft,assets,url \
    --jq 'if (.isDraft == false and (.assets | length) > 0) then "ready " + .url else "waiting" end' || true
  sleep 30
done
```

    - Report the final release URL and asset count.
    - If assets do not appear before the timeout, inspect the GitHub Actions run and report the failure.

## Landing news visuals

When news visuals are requested, use this preferred Cadencr direction unless the developer gives a different brief. The [v0.14.0 announcement](../../../docs/changelog/v0.14.0/everyday-improvements.png) is the approved reference for tone and restraint, not a template to repeat literally.

### Announcement image

- Aim for a premium, abstract, minimal composition: generous negative space, a clear focal point, and very few elements. Use the graphite/emerald palette from `packages/brand/` and `DESIGN.md`. Keep the brand signature optional; when included, use the official Cadencr symbol alone, without the `CADENCR` wordmark.
- Choose one simple visual metaphor for the release's main feature. For custom tabs, a large emerald **+** with a few quiet, overlapping tab shapes conveys adding your own tools. Adapt the metaphor to later releases; do not reuse the plus by default.
- Keep copy sparse: a short feature title, an optional one-line tagline, and the release version. Keep the main feature motif prominent, and check that the title and any included symbol remain legible when reduced inside the changelog modal or news article; judge their size there, not only on the full-resolution export.
- Keep full application windows, detailed graphs, code, controls, and feature inventories out of the announcement composition. Avoid technical diagrams, explanatory arrows, numbered callouts, and classroom-style infographics.
- Do not add labels such as “Interface preview” or “sample data” to the artwork. Keep the image clean and ensure the surrounding article accurately describes what it represents.
- Prefer simple vector/CSS geometry for brand-led artwork when it gives a more faithful result; use image generation when the concept benefits from an illustration. Do not fabricate a detailed product interface for the hero.

### Feature screenshots in the article

- Use authentic captures of the running Cadencr interface to demonstrate the features discussed in the corresponding sections. For custom tabs, show a useful tab actually open in the workspace, such as Files graph with its treemap of changed files.
- Frame the feature clearly while retaining enough app context to show where it lives. A focused crop is useful; a reconstructed window or an AI-generated interface is not a product screenshot.
- Add a short caption explaining the practical benefit and alt text describing the visible feature. Keep screenshots separate from the abstract announcement image.

### Assets and verification

- A landscape announcement image around 1600 × 900 is a useful starting point. Check that the motif and short title remain readable at article and in-app changelog sizes.
- When sharing the announcement image with the changelog, commit one source asset under `docs/changelog/vX.Y.Z/`, import it into the news MDX, and reference its tag-pinned raw URL in the changelog. A release-wide announcement image can sit directly below the release heading.
- Store article-only screenshots under `packages/landing/src/assets/news/vX.Y.Z/` and use the existing `DocScreenshot.astro` component. Compress assets, preserve sharp UI text, and verify the article on desktop and mobile.

## Changelog images (optional)

Images remain optional. For an abstract announcement graphic or a screenshot of a new feature, use this technique so it renders in the in-app changelog dialogs:

1. **Commit the image to the repository** under `docs/changelog/vX.Y.Z/`, in the release preparation commit, with a descriptive kebab-case name (`docs/changelog/v0.14.0/sidebar-presets.png`).
   - Formats: PNG, JPEG, GIF, WebP, AVIF, or SVG. Hard limit 10 MB; compress screenshots and aim for well under 1 MB.
2. **Reference it by its raw GitHub URL pinned to the release tag**, on its own line indented under the bullet it illustrates, with alt text describing what it shows:

   ```md
   - [**Desktop**] Added sidebar presets … — [@handle](https://github.com/handle).

     ![Sidebar with the Supervise preset applied](https://raw.githubusercontent.com/merkr-software/cadencr/vX.Y.Z/docs/changelog/vX.Y.Z/sidebar-presets.png)
   ```

   - To constrain the size, use HTML instead: `<img src="https://raw.githubusercontent.com/…" alt="…" width="720">`.
   - `https://github.com/merkr-software/cadencr/blob/<ref>/<path>?raw=true` and `…/raw/<ref>/<path>` also work, but prefer the `raw.githubusercontent.com` form.

3. **Do not use** relative paths (`docs/changelog/…`), images hosted on any other site, or GitHub drag-and-drop uploads (`github.com/user-attachments/…`). The desktop app only loads files committed to `merkr-software/cadencr` (its CSP blocks remote images, so the main process fetches them from that repository only); anything else shows as an "image unavailable" chip.
4. **Verify after pushing the tag.** The tag-pinned URL returns 404 until `git push origin vX.Y.Z`, so check it once the release exists:

   ```bash
   curl -sI "https://raw.githubusercontent.com/merkr-software/cadencr/$TAG/docs/changelog/$TAG/<name>.png" | head -1
   ```

   Pinning to the tag (not `main`) keeps old release notes intact if the image is later moved or deleted.

## Response format

When the release is complete, respond with:

1. `Previous release`: previous tag version only.
2. `Release content`: changelog section and landing news file, or note that the release is changelog-only.
3. `Security review`: review result and any fixes.
4. `Version updates`: files changed.
5. `Tag`: local tag and push status.
6. `GitHub release`: URL and asset count, or the failing workflow status.
