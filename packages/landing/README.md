# @cadence/landing

Static marketing site for Cadence, built with Astro + MDX + Tailwind v4 and deployed to GitHub Pages.

## Scripts

```bash
pnpm --filter @cadence/landing dev       # http://localhost:4321/cadence/
pnpm --filter @cadence/landing build     # outputs to dist/
pnpm --filter @cadence/landing preview   # serve dist/ locally
pnpm --filter @cadence/landing ts-check
pnpm --filter @cadence/landing lint
pnpm --filter @cadence/landing format:check
```

## Structure

- `src/pages/` — routes (`index.astro`, `/docs`, `/news`, `/roadmap`, `404.astro`)
- `src/components/` — section components (Nav, Hero, Features, Footer) and shared primitives
- `src/content/` — MDX content collections for news and roadmap entries
- `src/styles/` — Tailwind v4 import, design tokens, and landing-specific styles
- `design/` — original HTML mockup used as the source of truth for copy and markup

## Deployment

Pushes to `main` that touch `packages/landing/**` trigger `.github/workflows/landing-deploy.yml`, which builds the site and publishes to GitHub Pages.

If a custom domain is configured, update `site` + `base` in `astro.config.mjs` and add `public/CNAME`.
