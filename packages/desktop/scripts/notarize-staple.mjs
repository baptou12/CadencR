import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const NOTARY_PROFILE =
  process.env.APPLE_NOTARIZE_PROFILE ?? process.env.CADENCR_NOTARY_PROFILE ?? "cadencr-notary";
const DIST_DIR = new URL("../dist-electron/", import.meta.url).pathname;
const STATE_FILE = join(DIST_DIR, ".notarization", "submissions.json");

main();

function main() {
  if (!existsSync(STATE_FILE)) {
    throw new Error(`No notarization state file found at ${STATE_FILE}`);
  }

  const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  for (const submission of state.submissions) stapleIfAccepted(submission);
}

function stapleIfAccepted(submission) {
  const info = run("xcrun", [
    "notarytool",
    "info",
    submission.id,
    "--keychain-profile",
    NOTARY_PROFILE,
    "--output-format",
    "json",
  ]);
  const status = JSON.parse(info.stdout).status;
  const artifactPath = join(DIST_DIR, submission.artifact);

  if (status !== "Accepted") {
    console.log(`Skipping ${submission.artifact}: ${status}`);
    return;
  }

  run("xcrun", ["stapler", "staple", artifactPath]);
  run("xcrun", ["stapler", "validate", artifactPath]);
  run("spctl", ["--assess", "--type", "open", "--verbose=4", artifactPath]);
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
