/**
 * Detect when the host is serving newer frontend code than the one this PWA is
 * running. An installed iOS standalone PWA has no reload button, so it can sit
 * on stale code indefinitely; we surface a "reload" prompt when the served build
 * differs from the running one.
 *
 * The signal is the content-hashed entry bundle name (e.g.
 * `/assets/index-AbC123.js`), not a semantic version — so it changes on *every*
 * build, including unreleased local ones, which is exactly the case to cover.
 * Pairs with the server's `Cache-Control: no-cache` on `index.html`, so the
 * `no-store` fetch below always reflects the build currently on disk.
 */

/** Pull the content-hashed entry-module `src` out of an index.html string. */
function entryFromHtml(html: string): string | null {
  // Match the module script that points at a hashed `/assets/*.js` bundle,
  // regardless of attribute order (Vite emits `type="module" ... src="..."`).
  const match = html.match(/<script[^>]*\bsrc="([^"]*\/assets\/[^"]*\.js)"/);
  return match ? match[1] : null;
}

/**
 * The entry bundle this document booted from — captured from the live DOM, so
 * it's the build actually running. `null` in dev (the entry is `/src/main.tsx`,
 * not a hashed asset), which keeps the check inert outside packaged builds.
 */
function runningEntry(): string | null {
  if (typeof document === "undefined") return null;
  const script = document.querySelector<HTMLScriptElement>(
    'script[type="module"][src*="/assets/"]',
  );
  return script?.getAttribute("src") ?? null;
}

/** Fetch the freshly-served index.html (bypassing all caches) and read its entry. */
async function servedEntry(): Promise<string | null> {
  const res = await fetch(`${location.origin}/`, { cache: "no-store" });
  if (!res.ok) throw new Error(`index.html fetch failed (HTTP ${res.status})`);
  return entryFromHtml(await res.text());
}

/**
 * True when the host serves a different entry bundle than the running one.
 * Returns false (rather than throwing) when either side is unknown — a transient
 * fetch failure or a dev build should never nag the user to reload.
 */
export async function isUpdateAvailable(): Promise<boolean> {
  const running = runningEntry();
  if (!running) return false;
  try {
    const served = await servedEntry();
    return served !== null && served !== running;
  } catch (err) {
    // Background poll: a transient network blip is not a user-facing failure and
    // must not nag a reload (the next focus/interval check retries) — but leave a
    // breadcrumb so a *persistent* failure is debuggable rather than invisible.
    console.warn("Remote update check failed:", err);
    return false;
  }
}
