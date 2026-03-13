/**
 * Vitest global setup for main-process tests.
 *
 * Rebuilds better-sqlite3 for the system Node ABI so tests that use the real
 * native module (e.g. migrations.test.ts) don't fail with NODE_MODULE_VERSION
 * mismatch.  The Electron-compatible binary is restored in teardown so that
 * `pnpm start` keeps working after running tests.
 */
import { execSync } from "child_process";

let needsRestore = false;

export async function setup() {
  try {
    // Smoke test: actually load the native binding under this Node
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(":memory:");
    db.close();
  } catch {
    console.log("[test-global-setup] Rebuilding better-sqlite3 for system Node...");
    execSync("npm rebuild better-sqlite3", {
      stdio: "inherit",
      cwd: process.cwd(),
    });
    needsRestore = true;
  }
}

export async function teardown() {
  if (needsRestore) {
    console.log("[test-global-setup] Restoring better-sqlite3 for Electron...");
    execSync("npx electron-rebuild -f -w better-sqlite3", {
      stdio: "inherit",
      cwd: process.cwd(),
    });
  }
}
