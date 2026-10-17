# @cadencr/tab-kit

Cadencr's look for **custom tabs**: theme tokens, a Tailwind CSS v4 preset, the
Inter UI font, and the desktop app's own React components. Use it with
`@cadencr/tab-sdk`, which keeps the tokens in sync with the live
Cadencr theme.

## Setup

```css
/* src/styles.css */
@import "tailwindcss";
@import "@cadencr/tab-kit/preset.css";
```

```tsx
import { connect } from "@cadencr/tab-sdk";
import { Badge, Button } from "@cadencr/tab-kit";
import "./styles.css";

await connect(); // applies the Cadencr theme to <html>

<Button variant="outline">
  Refresh <Badge variant="secondary">3</Badge>
</Button>;
```

The preset needs `@tailwindcss/vite` (or another Tailwind v4 integration) in
your build. Everything else — fonts, animations, component styles — ships in
the package; nothing is fetched at runtime.

## What's inside

| Entry                         | Contents                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `@cadencr/tab-kit/tokens.css` | Default `--cadencr-*` values: CadencR Dark on `:root` and `[data-appearance="dark"]`, CadencR Light on `[data-appearance="light"]`. |
| `@cadencr/tab-kit/fonts.css`  | Inter Variable (100–900), the desktop UI font, bundled.                                                                             |
| `@cadencr/tab-kit/preset.css` | Imports both, maps Tailwind's theme onto the tokens, sets the base layer, and registers the components' classes.                    |
| `@cadencr/tab-kit`            | React components and `cn()`.                                                                                                        |

### Utilities

The preset uses the desktop app's utility names: `bg-background`,
`text-foreground`, `bg-card`, `bg-popover`, `bg-primary`,
`text-primary-foreground`, `bg-secondary`, `bg-muted`, `text-muted-foreground`,
`bg-accent`, `bg-destructive`, `border-border`, `border-input`, `ring-ring`,
`bg-chart-1`…`bg-chart-5`, `bg-sidebar*`, `bg-surface-sunken`, `text-acc-green`
(and `acc-cyan`, `orange`, `pink`, `purple`, `red`, `yellow`, `comment`),
`rounded-sm/md/lg/xl`, `font-sans` (Inter) and `font-mono` (the desktop's system monospace stack). `dark:` follows
the Cadencr theme (`data-appearance`), not the OS setting. Every other theme
token is available as a CSS variable, e.g. `var(--cadencr-diff-add-bg)`.

### Components

`Badge`, `Button`, `Checkbox`, `ContextMenu*`, `DropdownMenu*`, `Input`,
`Popover*` (+ `PopoverModality`), `Progress`, `ScrollArea`, `Select*`,
`Separator`, `Skeleton`, `Switch`, `Tabs*`, `Textarea`, `Tooltip*` (wrap the
tree in `TooltipProvider`), and `cn`. They are the exact components the
desktop app renders (`packages/desktop/src/components/ui`), compiled — not a
copy.

Kit-native primitives (desktop has no generic equivalent, so they live in the
kit, styled only with the tokens and following the desktop settings-card
anatomy): `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`,
`CardFooter` — a recessed `surface-sunken` panel, `rounded-xl`, a 60% hairline;
`Label`; and `EmptyState({ icon?, title, description?, action? })`.

Radix, class-variance-authority, clsx, tailwind-merge and lucide-react are
bundled; only `react` and `react-dom` are peer dependencies. For full prop
types, also install `radix-ui`, `class-variance-authority` and `clsx` as dev
dependencies (the declarations reference their types).

## Licenses

Apache-2.0. Bundled third-party code is listed with its licenses in
`dist/THIRD_PARTY_LICENSES.txt`; Inter is under the SIL Open Font License
(`dist/fonts/OFL.txt`).

## Development

```bash
pnpm --filter @cadencr/tab-kit build            # dist/
pnpm --filter @cadencr/tab-kit test             # build + drift, boundary and example-consumer tests
pnpm --filter @cadencr/tab-kit generate:tokens  # refresh tokens.css from the desktop themes
```

`tokens.css` is generated from `packages/desktop/src/theme-cadencr.css`,
restricted to the token list in `packages/desktop/src/lib/themes/tokens.ts`; a
test fails when it drifts. Only self-contained desktop components can be
exported — a test fails if one starts importing app code. `example/` is a
private consumer the tests build to prove Tailwind generates the components'
classes.
