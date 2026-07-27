// Build-time constant injected by electron-vite via `define` in
// `electron.vite.config.ts`. Holds the git branch the bundle was built from,
// or "" when git could not be reached.
declare const __APP_BUILD_BRANCH__: string;

export type AppEnvironmentKind = "beta" | "dev" | "next";

/**
 * Which environment badge the sidebar shows:
 *
 * - `pnpm dev` → DEV, whatever the branch is.
 * - `pnpm build:local` on `next` → NEXT (integration build, not released).
 * - anything else, including packaged releases → BETA.
 *
 * Releases are built from a detached tag checkout, so they report no branch and
 * fall through to BETA.
 */
export function resolveAppEnvironmentKind(source: {
  branch: string;
  isDevServer: boolean;
}): AppEnvironmentKind {
  if (source.isDevServer) return "dev";
  return source.branch.trim() === "next" ? "next" : "beta";
}

export const APP_ENVIRONMENT_KIND: AppEnvironmentKind = resolveAppEnvironmentKind({
  branch: __APP_BUILD_BRANCH__,
  isDevServer: import.meta.env.DEV,
});
