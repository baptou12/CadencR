// Writes every generated brand asset into its consuming package, or verifies
// that what is committed still matches the brand source.
//
// Generated assets are committed at their consumers' existing paths so that
// electron-builder, Astro's public/, and index.html keep working untouched.
// The --check mode runs as part of this package's `test` script, so a stale
// asset fails pre-commit and CI.
//
// Run from repo root:
//   pnpm brand:install            # write everything
//   pnpm brand:check              # fail on drift
//   node packages/brand/scripts/install-assets.mjs desktop   # one target
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareAsset, renderAsset } from "../src/assets.mjs";
import { TARGETS } from "../src/targets/index.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const argv = process.argv.slice(2);
const names = argv.filter((a) => !a.startsWith("-"));

// Reject unknown flags before deciding to write: silently ignoring them means a
// typo like `--chek` reads as write mode and overwrites every committed asset.
const badFlags = argv.filter((a) => a.startsWith("-") && a !== "--check");
if (badFlags.length) {
  console.error(`unknown option(s): ${badFlags.join(", ")} — the only option is --check`);
  process.exit(1);
}
const check = argv.includes("--check");

const targets = names.length ? TARGETS.filter((t) => names.includes(t.name)) : TARGETS;
const unknown = names.filter((n) => !TARGETS.some((t) => t.name === n));
if (unknown.length) {
  console.error(
    `unknown target(s): ${unknown.join(", ")} — known targets: ${TARGETS.map((t) => t.name).join(", ")}`,
  );
  process.exit(1);
}

const drift = [];

for (const target of targets) {
  for (const asset of target.assets) {
    const rel = path.join(target.root, asset.path);
    const file = path.join(REPO_ROOT, rel);
    const expected = await renderAsset(asset);

    if (!check) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, expected);
      console.log("wrote", rel);
      continue;
    }

    let actual;
    try {
      actual = await readFile(file);
    } catch (error) {
      drift.push(`${rel}: ${error.code === "ENOENT" ? "missing" : error.message}`);
      continue;
    }
    try {
      const reason = await compareAsset(asset.kind, expected, actual);
      if (reason) drift.push(`${rel}: ${reason}`);
    } catch (error) {
      // A malformed ICO/ICNS directory lands here. Either side could be at
      // fault — usually the committed file, but a writer regression would look
      // the same — so don't assert which one in the message.
      drift.push(`${rel}: ${asset.kind} could not be compared — ${error.message}`);
    }
  }
}

if (!check) process.exit(0);

if (drift.length) {
  console.error(`${drift.length} brand asset(s) differ from the brand source:\n`);
  for (const line of drift) console.error(`  ${line}`);
  console.error("\nRun `pnpm brand:install` and commit the result.");
  process.exit(1);
}

const count = targets.reduce((total, t) => total + t.assets.length, 0);
console.log(`brand assets up to date (${count} checked)`);
