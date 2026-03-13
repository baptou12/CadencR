/**
 * Vitest global setup for main-process tests.
 *
 * Rebuilds better-sqlite3 for the system Node ABI so tests that use the real
 * native module (e.g. migrations.test.ts) don't fail with NODE_MODULE_VERSION
 * mismatch.  The Electron-compatible binary is restored in teardown so that
 * `pnpm start` keeps working after running tests.
 */
import { execSync } from "child_process";
import path from "path";
import { createRequire } from "module";

let needsRestore = false;

/** Find the root of the repository (contains node_modules with hoisted deps). */
function findRepoRoot(): string {
  const require = createRequire(import.meta.url);
  const resolved = require.resolve("better-sqlite3");
  // The resolved path will be inside node_modules/better-sqlite3/...
  // Walk up to the directory that *contains* node_modules
  const nmIndex = resolved.indexOf(`${path.sep}node_modules${path.sep}`);
  if (nmIndex !== -1) {
    return resolved.substring(0, nmIndex);
  }
  // Fallback: use process.cwd()
  return process.cwd();
}

export async function setup(): Promise<void> {
  try {
    // Smoke test: actually load the native binding under this Node
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(":memory:");
    db.close();
  } catch {
    console.log("[test-global-setup] Rebuilding better-sqlite3 for system Node...");
    const repoRoot = findRepoRoot();
    execSync("npm rebuild better-sqlite3", {
      stdio: "inherit",
      cwd: repoRoot,
    });
    needsRestore = true;
  }
}

export async function teardown(): Promise<void> {
  if (needsRestore) {
    console.log("[test-global-setup] Restoring better-sqlite3 for Electron...");
    const repoRoot = findRepoRoot();
    execSync("npx electron-rebuild -f -w better-sqlite3", {
      stdio: "inherit",
      cwd: repoRoot,
    });
  }
}
