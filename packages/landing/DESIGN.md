---
name: CadencR Landing
description: Marketing site for the CadencR agent IDE — Emerald Reserve, a premium graphite sheet where the product captures glow and one jewel-green accent carries the brand.
colors:
  ground: "#131416"
  rail: "#090A0C"
  raised: "#1A1B1D"
  ink: "#EFF0F2"
  soft: "#A7A9AD"
  muted: "#6E7176"
  hairline: "#34373A"
  hover-wash: "#202124"
  emerald: "#2DB47D"
  emerald-deep: "#087653"
  emerald-ink: "#131416"
  alarm-red: "oklch(0.682 0.206 24.421)"
typography:
  display:
    fontFamily: "Schibsted Grotesk Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(38px, 6vw, 68px)"
    fontWeight: 640
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Schibsted Grotesk Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(32px, 5vw, 52px)"
    fontWeight: 640
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Schibsted Grotesk Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(26px, 3.4vw, 36px)"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Schibsted Grotesk Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0.008em"
  lede:
    fontFamily: "Schibsted Grotesk Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "JetBrains Mono Variable, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.09em"
  brand:
    fontFamily: "Figtree Variable, Schibsted Grotesk Variable, ui-sans-serif, sans-serif"
    fontWeight: 800
    transform: uppercase
    letterSpacing: "0.05em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  pill: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  section: "64px"
  section-lg: "80px"
components:
  button-primary:
    backgroundColor: "{colors.emerald}"
    textColor: "{colors.emerald-ink}"
    rounded: "{rounded.lg}"
    height: "44px"
    padding: "0 20px"
  button-outline:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "44px"
    padding: "0 20px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.lg}"
    height: "36px"
    padding: "0 14px"
  fig-label:
    textColor: "{colors.muted}"
    typography: "{typography.label}"
  logo-mark:
    name: "Index Dots"
    geometry: "48-grid; twelve r1.9 dots on a r14.5 ring; solid emerald core r5.5"
    favicon_cut: "dots r3, core r7 (thicker cut for ≤32px raster)"
    colors: "dots = ink (currentColor); core = emerald on dark, emerald-deep on light"
---

# Design System: CadencR Landing

## 1. Overview

**Creative North Star: "Emerald Reserve"**

The landing page is a premium graphite sheet. It keeps the engineering-datasheet grammar the site was rebuilt on — one ruled column with continuous rails, numbered `Fig. NN` figures, hairline rules, spec tables, registration ticks — but the voice is a quiet luxury instrument: a darker rail around a lighter main ground, one jewel emerald used with restraint, a single loud CTA per view, and captures seated in deep studio shadows with a barely visible green top-light. Validated 2026-07 through the in-product palette lab in `palette-exploration.html` and Raphael's iterative review.

The chrome is near-monochrome: graphite ground, near-black rails, cool-white ink, light-gray hairlines, and one emerald accent. The real app captures — vivid, alive — are the only multi-hue objects on the page. They light the sheet the way monitors light a dark room.

The system explicitly rejects the generic AI-startup landing page: no hype superlatives, no fabricated dashboards, no gradient text, no aurora washes, no decorative grids — and no competing accents: each view has exactly one loud object.

**Key Characteristics:**
- One ruled sheet: continuous side rails (≥768px), hairline rules between sections, everything composed as rows.
- Numbered figure system: mono `Fig. NN` labels, the only all-caps tier besides the wordmark, with the number in emerald.
- Near-monochrome chrome; the product captures are the only multi-hue color; one emerald accent, one loud CTA per view.
- Schibsted Grotesk for display and body (a cool, tight cut — no width games); JetBrains Mono for the annotation layer; Figtree 800 caps for the wordmark only.
- The Index Dots mark: twelve ink dots on a ring around a solid emerald core — the official logo, everywhere.
- Motion is one quiet rise-and-settle; content never gates on JavaScript.

## 2. Colors

A graphite instrument palette: near-black rail, slightly lighter main ground, cool ink, light-gray hairlines, one emerald. Canonical values are the hexes above; do not add green tint to neutral surfaces beyond the hero's explicitly bounded top-light.

### Primary
- **Emerald** (#2DB47D): the single brand accent, vivid enough to give the neutral instrument life without becoming neon. Primary buttons, fig-label numbers, spec-list plus ticks, focus rings, the logo core, and the accented word in a display line.
- **Emerald Deep** (#087653): the premium high-contrast cut for light grounds — the logo core on white and the `cadencr-light` primary. It does not replace Emerald on the dark landing page.

### Neutral
- **Ground** (#131416): the body and main-content background. Deep enough that captures glow, but visibly lighter than the rail.
- **Rail** (#090A0C): navigation and darkest inset chrome. It creates hierarchy without a green cast.
- **Raised** (#1A1B1D): muted fills and raised surfaces.
- **Ink** (#EFF0F2): primary text; also the logo's dots.
- **Soft / Muted** (#A7A9AD / #6E7176): secondary and tertiary text tiers. Use Soft for normal supporting copy and Muted only for metadata that remains nonessential.
- **Hover Wash** (#202124): neutral interactive hover state.
- **Hairline** (#34373A): every rule, rail, and border — intentionally light gray rather than hue-tinted.

### Status
- **Alarm Red** (oklch(0.682 0.206 24.421)): error semantics only (brew-copy failure). Never decorative.
- **ANSI set** (Dracula hexes, `--color-drac-*`): reserved exclusively for terminal/app depictions (StreamTerminal fixture, the brew-copy success tick). Never page chrome.

### Named Rules
**The Product-Is-The-Color Rule.** Page chrome stays within the neutral ramp plus one emerald. The app captures are the only saturated, multi-hue objects. If a decorative element wants a second color, it is wrong.

**The One-Loud-Object Rule.** Each view gets exactly one accent-filled element (the hero CTA). Secondary CTAs are hairline ghosts. Two competing accent fills is the SaaS tell this redesign exists to avoid.

**The Jewel-Light Rule.** Green in backgrounds is exceptional and near-invisible: the hero may carry one emerald top-light (≤4% alpha, wide radius) and hero-scale captures an emerald shadow (≤16% alpha). Everything else uses the neutral monitor-light (ink-mixed radial at 7%, blurred 48px). Anything louder is prohibited.

## 3. Typography

**Display Font:** Schibsted Grotesk Variable (wght 400–900; system-ui fallback)
**Body Font:** Schibsted Grotesk Variable
**Label/Mono Font:** JetBrains Mono Variable (ui-monospace fallback) — the same mono the desktop app uses
**Brand Font:** Figtree Variable, weight 800, uppercase, tracked 0.05em — the CADENCR wordmark only.

**Character:** One cool, tight grotesque at natural width — the 2026-07 round retired Archivo's wide setting (it read "music app", not "instrument"). Contrast comes from weight (400→640) and Ink vs Muted. JetBrains Mono whispers the annotation layer: fig labels, captions, version strips.

### Hierarchy
- **Display** (640, clamp(38px, 6vw, 68px), 1.05, -0.02em via `.type-display`): hero headline and closing CTA. `text-wrap: balance`.
- **Headline** (600, clamp(26px, 3.4vw, 36px), 1.12, -0.015em via `.type-h2`): section headings.
- **Card title** (600, 19px, 1.25): workbench card headings.
- **Body** (400, 16px, 1.6, +0.008em): base prose. Ledes are 15px/1.65 in Muted, capped at 54ch; `.em` spans lift to Ink 500.
- **Small** (400–500, 13–14px): spec rows, table descriptions, nav.
- **Label** (500, 10.5–11px, 0.08–0.09em, uppercase, mono): fig labels, captions, footer meta.
- **Wordmark** (Figtree 800, uppercase, 0.05em): `CADENCR`, always next to the Index Dots mark.

### Named Rules
**The Fig Rule.** Every kicker is a figure label: mono, uppercase, ≤11px, `Fig. NN` in emerald followed by a middot and the title. The only other all-caps text is the wordmark.

**The One Family Rule.** No second display face and no width axis. Contrast comes from weight and Ink vs Muted. Figtree appears only in the wordmark.

## 4. Elevation

Structure is drawn, not lifted: hairline rules and rails do all separation. Shadows exist to seat captures against the ground — deeper than before, studio-grade. The signature ornament is the registration mark — four 9px hairline corner ticks (`.reg-marks`) on major framed figures.

### Shadow Vocabulary
- **xs** (`0 1px 1px rgb(0 0 0 / 0.3)`): buttons, small chrome.
- **md** (`0 10px 28px rgb(0 0 0 / 0.42)`): frames at rest.
- **lg** (`0 28px 64px rgb(0 0 0 / 0.5)`): hero-scale staging.
- **emerald-seat** (`0 42px 100px -32px rgb(45 180 125 / 0.16)`): the hero capture only — the one emerald-tinted shadow on the page.
- **contour** (`drop-shadow(0 16px 32px rgb(0 0 0 / 0.34))`): frameless window PNGs.
- **hover** (`0 18px 44px rgb(0 0 0 / 0.45)`): `.frame:hover`, with an ink-mixed border brighten — no transform.

### Named Rules
**The Drawn-Not-Lifted Rule.** If a boundary is needed, draw a hairline. A shadow that isn't seating a capture is dead weight.

## 5. Components

### Logo (Index Dots)
The official mark: twelve r1.9 ink dots on a r14.5 ring around a solid emerald core (r5.5), on the 48 grid. Derived from the original dotted-ring favicon, distilled to two colors. `LogoMark.astro` renders it inline from tokens (dots `currentColor`, core `--color-primary`) so it follows the theme. Favicon and ≤32px rasters use the thicker cut (dots r3, core r7). On light grounds the core is Emerald Deep (#087653). Lockup: mark + `CADENCR` in Figtree 800 caps.

The ring geometry is defined once in `src/lib/logo-dots.mjs` and shared by both the inline mark and the icon pipeline. `scripts/generate-icons.mjs` (run by hand, uses `sharp`) regenerates every raster — the PNG favicons, `apple-touch-icon`, the manifest icons, `logo.png`, the PNG-entry `favicon.ico`, and the served `favicon.svg` (a baked ground/ink/emerald cut) — from that one source, so the on-screen logo and the icons can never drift.

### Sheet
`.sheet`: max-width 1180px, centered, `border-inline` rails from 768px up. `.rule`: a full-width hairline `border-top` marking every section row. Sections use `py-16 sm:py-20` (64/80px); figures may bleed past the rails deliberately.

### Buttons
- **Shape:** 8px radius, 44px tall at lg, 36px at md, 13–14px Schibsted medium.
- **Primary:** Emerald fill, Ground text; hover dims to 90%. One per view (the One-Loud-Object Rule).
- **Outline:** Ground fill, Ink text, Hairline border, xs shadow; hover uses the neutral wash.
- **Ghost:** transparent, Soft text; hover uses the neutral wash + Ink text.

### Fig label
`.fig-label`: mono 11px uppercase tracked 0.09em, Soft, with `.fig-no` (the `Fig. NN` or lead word) in emerald 600. Used above every section heading and in the hero version strip.

### Registration marks (signature)
`.reg-marks` + one `.reg-b` child: four hairline corner ticks in Muted, offset -5px, framing the hero video and the compare slider.

### Frame + fig caption
`.frame`: hairline border on Raised, hover brightens border and deepens shadow. Below framed media, `.fig-caption`: mono 11px uppercase with a 12px tick, e.g. `Fig. 00 · live capture, real session`.

### Spec list
`.spec-list`: the bullet replacement. Hairline-ruled rows (62% mix), 14px, emerald mono `+` tick at left, `strong` in Ink 560. Used for every feature enumeration.

### Spec table (compatibility)
Ruled rows: logo cell (hairline box on Raised), name (15px 600), description (14px Soft), and a mono `NN · supported` tag in emerald at the right (hidden on mobile).

### Compare slider (signature)
Range-input-driven before/after in a `.frame` with reg-marks: neutral ink divider + round handle, mono corner labels, keyboard-operable, no-JS degrades to a 50% split.

### FAQ rows
Ruled `details` rows: mono `01`-style index, 15px question, hairline-boxed plus toggle that rotates 45° and turns emerald when open. Answers are 14px/1.65 Soft, ≤62ch.

### Navigation
Sticky hairline-bottom bar on Ground at 90% with blur: Index Dots mark + `CADENCR` wordmark + version chip, links in scroll order (Compatibility, Features, News, Docs), mono GitHub pill, and an **outline** Download button (h-9) — a hairline ghost, not the emerald fill, so the hero CTA stays the one loud object (see the One-Loud-Object Rule). A 44px hamburger with `aria-expanded`; a `.skip-link` is the first tab stop.

## 6. Do's and Don'ts

### Do:
- **Do** compose every section as a ruled row of the sheet; if a boundary is needed, draw a hairline, never a glow.
- **Do** ship real captures of CadencR in every media slot, seated with contour shadow and neutral monitor-light (PRODUCT.md: "the product is the imagery").
- **Do** keep chrome near-monochrome with the single emerald accent and exactly one accent-filled CTA per view.
- **Do** render the logo from tokens via `LogoMark.astro`; use the favicon cut for ≤32px rasters and Emerald Deep on light grounds.
- **Do** give every animation a `prefers-reduced-motion` fallback and keep content visible without JavaScript (`.js`-gated reveals, native `details`).
- **Do** spell the brand "CadencR" in prose and `CADENCR` in the wordmark; keep entity disambiguation intact (PRODUCT.md: disambiguation-first SEO).
- **Do** carry this direction into the desktop defaults: Graphite Ground, Ink, Hairline, Emerald, with distinct semantic tool colors (see root `DESIGN.md`, "Brand identity").

### Don't:
- **Don't** build "a generic AI-startup landing page: no hype superlatives, no fabricated dashboards" (PRODUCT.md, verbatim).
- **Don't** use gradient text, side-stripe borders, aurora washes, decorative background grids, or glassmorphism. The 2026-02 redesign removed them; they do not come back.
- **Don't** fill more than one element per view with emerald. The nav Download stays a hairline ghost; the hero CTA is the loud one.
- **Don't** reintroduce the per-section Dracula accent spectrum in page chrome. ANSI colors live inside terminal/app depictions only.
- **Don't** let all-caps leave the fig-label + wordmark tiers, or mono leave the annotation layer.
- **Don't** use a second display face, a width axis, or a light theme. Ground (#131416) is the only body color.
- **Don't** animate layout or add entrance choreography beyond the single rise-and-settle; the sheet is calm. One deliberate exception: the StreamTerminal fixture's tiny status text stays intentionally terminal-faithful — its illegibility is the argument.
