---
# Cadencr Desktop — Design tokens and system definition
# Source of truth: Page - Unified agents.html
# Secondary: Page - Session.html (split-stacked layout reference only)

meta:
  project: Cadencr Desktop
  source_of_truth: Page - Unified agents.html
  secondary_reference: Page - Session.html
  default_theme: dracula
  default_screen: workspace        # Unified agents page lands on "unified"; Session lands on "workspace"

themes:
  # Three canonical themes. data-theme="..." selects the variant; theme-loader.jsx
  # maps the data-theme key to the JSON filename via FILE_MAP.
  #   light   → themes/aurora.json
  #   dark    → themes/dracula.json
  #   onedark → themes/one-dark.json

  aurora:
    id: aurora
    label: Aurora
    appearance: light
    data_theme_key: light
    file: themes/aurora.json
    background: oklch(0.985 0.004 290)
    surface: oklch(1 0 0)                       # --card
    surface_elevated: oklch(0.965 0.008 290)    # sidebar / background-deep
    border: oklch(0.905 0.015 290)
    text_primary: oklch(0.205 0.040 285)
    text_secondary: oklch(0.32 0.040 285)       # --foreground-soft
    text_muted: oklch(0.46 0.040 285)
    accent: oklch(0.55 0.245 295)               # --primary (also --acc-purple)
    accent_violet: oklch(0.45 0.20 295)         # blocks.thinking-accent — for Thinking blocks ONLY
    accent_thinking_bg: oklch(0.96 0.04 295)
    success: oklch(0.58 0.18 150)               # --acc-green — ready dot, +diffs
    danger: oklch(0.58 0.22 25)                 # --acc-red — retry counter, -diffs
    warning: oklch(0.66 0.18 55)                # --acc-orange — "in progress" / dev pill
    info: oklch(0.58 0.13 220)                  # --acc-cyan — file refs
    code_bg: oklch(0.97 0.008 290)
    code_fg: oklch(0.205 0.04 285)

  dracula:
    id: dracula
    label: Dracula
    appearance: dark
    data_theme_key: dark
    file: themes/dracula.json
    background: oklch(0.22 0.022 277.497)
    surface: oklch(0.22 0.022 277.497)          # --card
    surface_elevated: oklch(0.23 0.022 277.497) # --sidebar
    border: oklch(0.32 0.032 277.821)
    text_primary: oklch(0.977 0.008 106.793)
    text_secondary: oklch(0.85 0.012 277.5)     # --foreground-soft
    text_muted: oklch(0.56 0.08 270.087)
    accent: oklch(0.742 0.149 301.871)          # #bd93f9 — Dracula purple
    accent_violet: "#dbb1ff"                    # blocks.thinking-accent
    accent_thinking_bg: "#1f1d31"
    success: "#50fa7b"
    danger: "#ff5555"
    warning: "#ffb86c"
    info: "#8be9fd"
    code_bg: "#1a1b26"
    code_fg: "#f8f8f2"
    dracula_pink: "#ff79c6"                     # mention chip identity in dark theme
    dracula_yellow: "#f1fa8c"
    dracula_comment: "#6272a4"

  one_dark:
    id: one-dark
    label: One Dark
    appearance: dark
    data_theme_key: onedark
    file: themes/one-dark.json
    background: oklch(0.27 0.014 257)           # ~#282c34
    surface: oklch(0.27 0.014 257)              # --card
    surface_elevated: oklch(0.25 0.012 257)     # --sidebar
    border: oklch(0.34 0.014 257)               # ~#3e4451
    text_primary: oklch(0.78 0.018 257)         # ~#abb2bf
    text_secondary: oklch(0.760 0.014 245)
    text_muted: oklch(0.58 0.018 257)           # ~#5c6370
    accent: oklch(0.72 0.13 240)                # #61afef — One Dark blue
    accent_violet: "#c678dd"                    # blocks.thinking-accent — One Dark magenta
    accent_thinking_bg: "#2a2533"
    success: "#98c379"
    danger: "#e06c75"
    warning: "#d19a66"
    info: "#56b6c2"
    code_bg: "#21252b"
    code_fg: "#abb2bf"

# ─── Typography ──────────────────────────────────────────────────────────
typography:
  families:
    brand:
      stack: '"Figtree Variable", "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
      role: Brand wordmark — the "CADENCR" logotype, rendered at weight 800 (see --font-brand)
    ui:
      stack: '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
      role: All UI text — sidebar, tabs, prompts, agent prose
    mono:
      stack: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
      role: Code blocks, terminal, diff gutters, file paths, tool-call bodies, +/- counters

  scale:
    h_section_user: { size: 22px, weight: 700, line_height: 1.25, letter_spacing: -0.01em, role: "Agent stream — user-section heading (.cds-section h3)" }
    h_section_agent: { size: 17px, weight: 700, role: "Agent stream — agent-section heading (.cds-section h3.green)" }
    body: { size: 14px, weight: 400, line_height: 1.55, role: "Default body — html/body" }
    body_stream: { size: 13.5px, line_height: 1.55, role: "Agent stream prose (.cds-stream)" }
    bubble: { size: 13px, line_height: 1.55, role: "User bubble (.cds-user-bubble)" }
    tab: { size: 12.5px, weight: 500, role: "Tab strip label" }
    feature_row: { size: 12.5px, role: "Sidebar feature row" }
    chip: { size: 11.5px, weight: 500, role: "Action-bar chip" }
    tool_call: { size: 11.5px, family: mono, role: ".cds-tool — collapsed tool-call row" }
    tool_term: { size: 11px, family: mono, line_height: 1.65, role: "Bash tool output" }
    diff: { size: 12px, family: mono, line_height: 1.7, role: "Diff body / code blocks" }
    git_diff: { size: 11.5px, family: mono, line_height: 1.65, role: "Git tab diff body" }
    editor: { size: 11.5px, family: mono, line_height: 1.7, role: "Editor pane code" }
    eyebrow: { size: 10px, weight: 700, transform: uppercase, letter_spacing: 0.12em, role: "Sidebar section labels (PROJECTS)" }
    meta_user: { size: 10.5px, family: mono, role: "User/agent timestamp meta" }
    context_bar: { size: 10.5px, family: mono, role: "Context % footer" }
    beta_badge: { size: 8px, weight: 700, transform: uppercase, role: "BETA/dev badge" }
    git_meta: { size: 11px, family: mono, role: "Branch + +/- counters in tab strip" }

# ─── Spacing scale (extracted from kit.css) ───────────────────────────────
spacing:
  # Most kit.css values cluster on these steps. New components MUST pick from this list.
  steps:
    - 0
    - 2px
    - 4px
    - 6px
    - 7px      # used for tab strip (padding 7px 14px) — reserved for tabs
    - 8px
    - 9px
    - 10px
    - 12px
    - 14px
    - 16px
    - 18px
    - 22px

  fixed_widths:
    sidebar: 268px
    pane_right_default: 380px
    pane_right_wide: 460px
    pane_right_stacked: 520px
    sidebar_header_height: 56px
    topbar_min_height: 52px
    explorer: 200px

# ─── Radii ────────────────────────────────────────────────────────────────
radii:
  base: 0.625rem        # --radius
  sm: 6px               # --radius-sm
  md: 8px               # --radius-md
  lg: 10px              # --radius-lg
  pill: 9999px          # status dots, traffic lights

# ─── Shadows ──────────────────────────────────────────────────────────────
shadows:
  pop_dark: "0 8px 30px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.25)"   # dracula
  pop_onedark: "0 8px 30px rgba(0,0,0,.40), 0 2px 6px rgba(0,0,0,.22)"
  pop_light: "0 12px 36px -10px oklch(0.50 0.20 295 / 0.22), 0 2px 8px -2px oklch(0.30 0.10 285 / 0.10)"
  card_subtle: "0 1px 2px rgba(0,0,0,0.06)"   # active button on theme switch

# ─── Transitions ──────────────────────────────────────────────────────────
transitions:
  fast: 120ms
  default: 150ms
  theme_swap: 220ms ease     # html/body background+color
  hover: 100ms
  easing_default: ease

# ─── Layouts ──────────────────────────────────────────────────────────────
layouts:
  single:
    grid_template_columns: "1fr"
    description: "All four tabs in the root pane. Default for Unified agents view; also fine for narrow viewports."
    used_by: Page - Unified agents.html
  split:
    grid_template_columns: "1fr 380px"
    description: "Root pane: agent + terminal · Right floating: git + editor"
  split-stacked:
    grid_template_columns: "1fr 520px"
    grid_template_rows_right: "1fr 1fr"
    description: "Root pane: agent solo · Right is vertically split — Terminal top, Git+Editor bottom. The canonical Session layout."
    used_by: Page - Session.html
  wide:
    grid_template_columns: "1fr 460px"
    description: "Root pane: agent solo · Right floating: git + editor + terminal in one tab strip"

# ─── Status palette (RESERVED — never reuse for decoration) ───────────────
status:
  ready: success           # green dot in worktree row, agent feat-title dot
  in_progress: warning     # orange — feature row "in progress" pill
  retry: danger            # red — retry counter on prompt action bar
  thinking: accent_violet  # violet block bg in agent stream

# ─── Iconography ─────────────────────────────────────────────────────────
iconography:
  library: Lucide-style hand-rolled SVGs in icons.jsx
  stroke_width: 2
  default_size: 14
  small: 13
  micro: 10..12
  fill: none (stroke-only)
  rule: All glyphs use currentColor — never hard-code stroke/fill in the icon component
---

# Cadencr Desktop — Design System

## Brief

**What it is.** Cadencr Desktop is the developer-facing control surface for managing autonomous coding agents across multiple projects and worktrees. It is a single-window, four-pane workspace that lets a human supervise an agent's reasoning (Agent), watch it execute (Terminal), inspect what changed (Git), and verify the result (Editor) — all from one screen, without context-switching.

**Who it's for.** Senior individual contributors and tech leads who run multiple parallel agent sessions and need to scrub through reasoning, terminal output, and diffs faster than a chat thread allows. The product assumes the user reads code, knows what a worktree is, and prefers keyboard-driven dense IDEs over chat-style UIs.

**What it is NOT.** It is not a chat app — the agent stream is a transcript artifact, not a conversation surface. It is not a code editor — the Editor pane is a read-side review tool, not a place to write. It is not a generic AI sidebar; it is the primary workspace.

## Theme philosophy

Cadencr ships with three canonical themes — **Aurora** (vibrant light), **Dracula** (vibrant dark, the original), and **One Dark** (calm cool-gray dark for long sessions). Three is the floor and the ceiling. We do not ship "high contrast" or "solarized" variants because every additional theme is an additional QA matrix; the three we have cover the three reasons people switch — bright office, low-light room, all-day reading.

**Composition model.** A theme is a `data-theme="..."` attribute on `<html>` plus a JSON manifest in `themes/`. The CSS in `themes.css` provides every default. The JSON, loaded by `theme-loader.jsx`, overrides individual tokens with `!important`-equivalent specificity (a `.cds-theme-loaded` class on `<html>` raises the selector weight). This means **`themes.css` is the floor; the JSON is the ceiling.** A token missing from the JSON falls through to the CSS default — never null.

**Resolution.** The `data-theme` keys are short, the filenames are descriptive. The mapping lives in `theme-loader.jsx`'s `FILE_MAP`:

```
light   → themes/aurora.json
dark    → themes/dracula.json
onedark → themes/one-dark.json
```

**Adding a fourth theme.**
1. Drop `themes/<id>.json` matching the shape of `themes/aurora.json` (sections: `tailwind`, `accents`, `code`, `blocks`, `chips`, `editor`, `diff`, `terminal`, `xterm`).
2. Add a `data-theme` key → filename entry to `FILE_MAP` in `theme-loader.jsx`.
3. Add a button to the `ThemeSwitch` component in the relevant HTML file.
4. **No changes to `themes.css`.** If you find yourself editing `themes.css`, you are doing it wrong.

## Layout decision logic

The pane configuration is a single `tweaks.layout` value with four legal states. Every layout MUST be registered in (a) the `config` `useMemo` in the HTML file's `App` component, (b) the `cds-split` CSS rules in `kit.css`, and (c) the `TweakRadio` options in the Tweaks panel. A layout that is not in all three places is broken.

| Layout | When to use | Default for |
|---|---|---|
| `single` | All four tabs in one pane. Use when the viewport is narrow, when the user is reviewing one thing at a time, or as a fallback. | Unified agents (the cards already show many agents — no need for split panes inside a card). |
| `split` | Two equal-priority surfaces — agent reasoning + one inspection pane. The classic IDE feel. | Generic "I'm doing one feature" sessions. |
| `split-stacked` | Agent gets the full left column. Right column is vertically split — Terminal top, Git+Editor bottom. Use when terminal output and the diff are both running hot and the user wants to glance at both without tabbing. | **Session view (`Page - Session.html`).** |
| `wide` | Agent solo on the left, every other tool stacked into one tabbed pane on the right. Use for narrow secondary monitors or when the agent narrative is the main content. | One-off; not a default. |

**Session vs Unified agents.** Unified agents lands on `screen="unified"` and renders `<UnifiedAgentsView>` — a grid of agent cards. Session lands on `screen="workspace"` and renders the four-pane workspace. They share the same React component tree below the screen switch; the screen value is the only routing concept.

## Component anatomy

### AgentPanel (`<window.Panels.AgentPanel/>`)

The agent stream. A vertical scroll of mixed content: user bubbles, agent prose, code blocks, tool calls, thinking blocks. **This is the most important surface in the product** — every other pane is in service of what's happening here.

- **Structure:** `.cds-stream > [meta, bubble | section | tool, ...]` in document order.
- **States:** Tool calls have collapsed (single-line button) and open (expanded with diff/term body) states. The collapsed `.cds-tool` is a `<button>`; the open one is a `<div>`.
- **Tokens consumed:** `--background`, `--foreground`, `--primary-glow` (user bubble), `--ic-bg`/`--ic-fg` (mention chips), `--ic-file-bg`/`--ic-file-fg` (file refs), `--code-bg`/`--code-fg` (code blocks), `--diff-add-bg`/`--diff-del-bg`, `--tag-grep`/`--tag-read`/`--tag-bash`/`--tag-edit`/`--tag-think`, `--h-user`/`--h-agent` (section headings).
- **When to use vs alternative:** This is the only place agent reasoning surfaces. Do not duplicate.

#### Thinking block (sub-component)

A collapsible card with a violet-tinted background distinct from the surrounding stream. The violet IS the affordance — it tells the user "this is meta-reasoning, not output." Use `accent_violet` and `accent_thinking_bg` from the theme. **Never use `--primary` for a thinking block** even when `--primary` happens to be violet (Dracula): the contract is that thinking has its own slot, separate from primary-action color.

#### MCP tool call

Same chrome as a regular tool call (`.cds-tool`) but the `.tag` element gets a colored prefix indicating provider. Body is monospace, file paths in cyan (`--ic-file-fg`), counts in `--acc-green`/`--acc-red`. Bash variant gets terminal-style chrome (`.cds-tool.open.bash`) via its own `--block-bash-header-bg` / `--block-bash-body-bg` / `--block-bash-fg` / `--block-bash-muted-fg` tokens, which follow the theme (dark on Dracula, light on Aurora). The live xterm still stays dark in every theme — see rule 10.

### TerminalPanel (`<window.Panels.TerminalPanel/>`)

Static terminal-style log. Always uses `--code-bg` and `--code-fg` regardless of theme — even Aurora's terminal stays dark. This is intentional: a terminal that flips to white-bg looks broken to developers.

- **Structure:** `.cds-terminal > div.line[.kind]`. Kinds: `cmd`, `ok`, `info`, `mod`, `add`, plain.
- **States:** Static. No interactive states.
- **Tokens:** `--code-bg`, `--code-fg`, `--acc-green` (ok), `--acc-yellow` (info/warn), `--acc-cyan` (urls + branch).

### GitPanel (`<window.Panels.GitPanel/>`)

Three rows: head (file path + +/- stats + Viewed checkbox), body (diff hunks), foot (file count + view mode toggle).

- **Structure:** `.cds-git > [.cds-git-head, .cds-git-body, .cds-git-foot]`.
- **States:** Body rows are `.add` / `.del` / `.unchanged` / `.ctx`. Foot toggle is Unified (default) or Split.
- **Tokens:** `--diff-add-bg`, `--diff-del-bg`, `--code-bg`, `--code-fg`, `--acc-green`/`--acc-red` for stats.

### EditorPanel (`<window.Panels.EditorPanel/>`)

Two-column grid: 200px file explorer + code area with tab strip and footer. Read-only. Syntax tokens (`tok-kw`, `tok-str`, `tok-type`, `tok-prop`, `tok-comment`, `tok-num`, etc.) map to `--acc-*` accents.

- **States:** Explorer item active/dim. Editor tab active.
- **Tokens:** `--code-bg`, `--code-fg`, `--primary` (active explorer item via 28% mix), `--acc-pink`/`--acc-cyan`/`--acc-green`/`--acc-yellow` for syntax.

### Sidebar (`<window.Sidebar/>`)

268px fixed-width left rail. Header (traffic lights + brand + dev pill) → All-agents nav button → Projects scroll area → Settings footer.

- **Structure:** `.cds-sidebar > [.cds-sidebar-header, .cds-sidebar-nav, .cds-sidebar-scroll, .cds-sidebar-footer]`.
- **Project group:** `.cds-project-group > [.cds-project-row, .cds-feature-list]`. The feature list has a left rail (`border-left: 1px solid var(--sidebar-border)`).
- **Active feature:** `.cds-feature-row.active` gets a `--primary` 18% mix bg + a `.cds-active-rail` 2px primary bar at left:-11px.
- **Tokens:** `--sidebar`, `--sidebar-border`, `--accent` (hover bg), `--primary`/`--primary-glow` (active state), `--muted-foreground` (eyebrows + counts), `--acc-green`/`--acc-pink`/`--acc-orange` (project dots).
- **When to use vs alternative:** The sidebar is global navigation. Per-pane navigation goes in the tab strip, not here.

### TopBar

52px-min-height bar above the split. Owns the feature title, the theme switcher, the new-action button, and the settings gear.

- **Structure:** `.cds-topbar > [.feat-title, .cds-top-actions]`.
- **Tokens:** `--background`, `--border`.

### PromptBar

The agent input. Lives in the root pane only — never duplicate it in a floating pane.

- **Structure:** `.cds-prompt-wrap > .cds-prompt-bar > [textarea, .cds-prompt-actions]` followed by `.cds-context-bar`.
- **States:** Default (muted bg, transparent border) → focus-within (card bg, primary border, primary-glow ring). Send button disables when textarea is empty.
- **Tokens:** `--muted` (default bg), `--card` (focus bg), `--primary` (focused border + send button bg), `--primary-glow` (focus ring), `--on-primary` (send icon).

### ActionBar

Five chips above the prompt: Auto-scroll · Autonomy · Model · Thinking effort · Errors. The error chip is `success`-styled when count is 0, `danger` when nonzero.

- **States:** chip default, chip.on (toggled), chip.success/warn/primary/ghost.
- **Tokens:** `--border`, `--accent` (hover), `--primary`/`--primary-glow` (model chip + .on), `--acc-green`/`--acc-orange` (status chip variants).

### Worktree row

A single-line indicator above the tab strip in Session/workspace view: branch icon + worktree path + clipboard chip + ready dot. Sits between TopBar and the pane tabs. Uses `success` for the ready state — never warm-orange or accent.

### Status dot

A 7–9px circle with a 2–3px halo (`box-shadow` 0 0 0 spread). Three legal slots:
- `--status-ip` (success/green) — feature in flight, "ready" worktree
- `--acc-orange` — "in progress" annotation
- `--acc-pink` (Dracula) — secondary project marker

The dot's color is the meaning. Do not introduce a fourth color without registering it as a status token.

## Iconography & status colors

- **Green dot** = ready (worktree set up, agent connected). Bound to `--status-ip` / `success`.
- **Violet block bg** = thinking (agent meta-reasoning). Bound to `accent_violet` / `--acc-purple` (Dracula uses `--primary`, but only via the `accent_violet` token, never via raw `--primary`).
- **Red counter** = retry / errors / -diff. Bound to `danger` / `--acc-red`.
- **Orange chip** = "in progress" / dev-pill. Bound to `warning` / `--acc-orange`.
- **Cyan path** = file reference. Bound to `info` / `--acc-cyan` (`--ic-file-fg`).
- **Pink chip** = mention / `@thing`. Bound to `--ic-fg` (`--acc-pink` in Dracula).

**Status colors are reserved.** Do not reuse green for "selected", or red for "delete button hover", or violet for a generic accent badge. If a non-status surface needs a tint, use `--accent` (the muted hover bg) or `--primary` (the brand action color) — never a status hue.

## Don'ts

1. **No fonts other than Inter, JetBrains Mono, and Figtree (brand wordmark only).** Do not import Roboto, system-ui first, Fraunces, or Arial. The font stacks in `themes.css` are the only legal stacks. Figtree is the one registered third face — it is reserved for the `CADENCR` wordmark (`--font-brand`, weight 800) and must not be used for UI or body text. If a further face is needed, add it here with a clear role.
2. **No hardcoded hex in JSX.** Every color in a component file goes through a `var(--...)` lookup. Inline `style={{ color: "#..." }}` is forbidden except for placeholder squares in fixtures (and even those should be CSS classes).
3. **No purple gradients on white.** Aurora is light but not whimsical. Solid colors only; the only gradients in the system are the `--primary-glow` color-mix effects on focus/hover.
4. **No new spacing values outside the kit.css scale.** If you need 11px, you actually need 10 or 12. If you need 13px, use 12 or 14. Pick the closest step.
5. **Thinking blocks always use `accent_violet`, never `accent`.** Even in Dracula where they happen to look similar, the contract is separation: future themes may diverge them.
6. **No CSS-in-JS.** All styling lives in `kit.css` and `themes.css`. JSX may reference CSS variables inline (`style={{ background: "var(--acc-green)" }}` is fine for a one-off swatch), but no `styled-components`-style libraries, no inline rule sets larger than ~3 declarations, and no class-name generators.
7. **No new layout without registering it in all three places** — `config` useMemo, `kit.css` `cds-split` rules, and the `TweakRadio` options. A layout that exists in two of the three is a bug.
8. **Status colors never used for branding.** Green is "ready". Red is "retry". Orange is "in progress". The brand color is `--primary`. Do not put the logo in green to imply "we're alive."
9. **The `--code-bg` / `--code-fg` surface stays dark even in Aurora.** Markdown code blocks and editor-adjacent code surfaces are intentionally Dracula-like in the light theme — a white code block looks washed-out and breaks the dev-tool convention. The bash tool-call block is the one carve-out: it follows the theme via `--block-bash-*` (see "Bash variant").
10. **Live terminal (xterm/PTY) never inverts.** Always uses `--code-bg` and stays dark regardless of theme. Future theme JSONs MUST keep `terminal.bg` dark.
11. **No new screen-level routes without a `data-screen-label`.** Every full-pane screen must set `data-screen-label="NN Title"` (1-indexed) on the `.cds-app` so review comments can pin to it.
12. **No prompt bar outside the root pane.** It lives once, in the non-floating root pane. Floating panes never own input.
13. **No untranslated tweak.** Every value in `TWEAK_DEFAULTS` must round-trip through the Tweaks panel — i.e. there is a `Tweak*` control bound to it. No "secret" tweaks.

## Self-audit (sample screens)

**Settings panel.** Already covered — uses `--card`, `--border`, `--muted`, sidebar tokens for nav, primary for active row. No new tokens needed; the page goes through `screen="settings"` and renders `<window.SettingsPage>`. ✓

**Empty-state for the agent stream.** Tokens needed:
- `--muted-foreground` for the prose
- `--accent` for the "What can I help with?" affordance background
- An icon at 32px stroke-2 (extension of the `iconography.scale` — added "xl: 32" implicitly; explicitly noted that empty states may use `28–40px` icons, the only place above 22).

**Error toast.** Needed tokens:
- `--acc-red` (border + accent strip)
- `--card` (toast surface)
- `--shadow-pop` (lift)
- 4–6s auto-dismiss falls under `transitions` but isn't currently a token. **Added constraint:** ephemeral overlay durations (toast, tooltip auto-hide) use `transitions.toast: 4000ms`. Add this if/when toasts ship — until then, do not invent a duration.

**Audit conclusion.** The token coverage is complete for current surfaces. Two implicit constraints surfaced and are now explicit in the YAML/Don'ts: code surfaces stay dark across themes (rule 9), and large empty-state icons are the only legal exception to the icon size cap.
