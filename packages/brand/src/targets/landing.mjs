// Brand assets served by the marketing site. Filenames here are load-bearing:
// public/site.webmanifest names the web-app-manifest-* files, BaseLayout.astro
// resolves og-image.png by URL, and src/lib/seo.ts points the schema.org
// Organization logo at logo.png. Renaming an entry silently breaks those.
import { faviconIcoEntries, tileFavicon, tileStandard } from "../svg/mark.mjs";
import { socialSvg } from "../svg/social.mjs";

export const landing = {
  name: "landing",
  root: "packages/landing",
  assets: [
    { path: "public/favicon.svg", kind: "svg", svg: tileFavicon },
    { path: "public/favicon.ico", kind: "ico", entries: faviconIcoEntries() },
    { path: "public/favicon-16x16.png", kind: "png", size: 16, svg: tileFavicon },
    { path: "public/favicon-32x32.png", kind: "png", size: 32, svg: tileFavicon },
    { path: "public/favicon-48x48.png", kind: "png", size: 48, svg: tileStandard },
    { path: "public/favicon-96x96.png", kind: "png", size: 96, svg: tileStandard },
    { path: "public/apple-touch-icon.png", kind: "png", size: 180, svg: tileStandard },
    { path: "public/web-app-manifest-192x192.png", kind: "png", size: 192, svg: tileStandard },
    { path: "public/web-app-manifest-512x512.png", kind: "png", size: 512, svg: tileStandard },
    // Press / schema.org Organization logo — not referenced by any <link>.
    { path: "public/logo.png", kind: "png", size: 512, svg: tileStandard },
    // og:image / twitter:image — BaseLayout.astro resolves this filename by URL.
    {
      path: "public/og-image.png",
      kind: "png",
      size: { width: 1280, height: 640 },
      svg: socialSvg,
    },
  ],
};
