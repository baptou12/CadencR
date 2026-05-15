import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const NOTARY_PROFILE =
  process.env.APPLE_NOTARIZE_PROFILE ?? process.env.CADENCR_NOTARY_PROFILE ?? "cadencr-notary";
const DIST_DIR = new URL("../dist-electron/", import.meta.url).pathname;
const STATE_DIR = join(DIST_DIR, ".notarization");
const STATE_FILE = join(STATE_DIR, "submissions.json");

main();

function main() {
  if (process.platform !== "darwin") {
    throw new Error("Artifact notarization must run on macOS.");
  }

  const artifacts = findArtifacts(DIST_DIR).filter((artifact) => artifact.endsWith(".dmg"));
  if (artifacts.length === 0) throw new Error(`No DMG artifacts found in ${DIST_DIR}`);

  const submissions = artifacts.map(submitArtifact);
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify({ createdAt: new Date().toISOString(), submissions }, null, 2)}\n`);

  console.log(`\nSubmitted ${submissions.length} DMG artifact(s) for notarization.`);
  console.log(`State file: ${STATE_FILE}`);
  console.log("Check status with: pnpm --filter @cadencr/desktop notarize:mac:status");
  console.log("Staple accepted DMGs with: pnpm --filter @cadencr/desktop notarize:mac:staple");
}

function findArtifacts(root) {
  const entries = [];
  walk(root, entries);
  return entries.filter((entry) => entry.endsWith(".dmg") || entry.endsWith(".zip"));
}

function walk(dir, entries) {
  for (const name of readdirSync(dir)) {
    if (name === ".notarization") continue;
    const path = join(dir, name);
    const stats = statSync(path);
    if (stats.isDirectory()) walk(path, entries);
    if (stats.isFile()) entries.push(path);
  }
}

function submitArtifact(artifactPath) {
  console.log(`\nSubmitting DMG artifact: ${artifactPath}`);
  const result = run("xcrun", [
    "notarytool",
    "submit",
    artifactPath,
    "--keychain-profile",
    NOTARY_PROFILE,
    "--output-format",
    "json",
  ]);
  const output = JSON.parse(result.stdout);
  console.log(`Submitted ${basename(artifactPath)}: ${output.id}`);

  return {
    artifact: relative(DIST_DIR, artifactPath),
    id: output.id,
    submittedAt: output.createdDate ?? new Date().toISOString(),
  };
}

function run(command, args) {
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${command} ${args.join(" ")}`);
  }
  return result;
}
