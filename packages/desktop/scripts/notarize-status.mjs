import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
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
  const rows = state.submissions.map(fetchStatus);

  console.log("\nNotarization status");
  console.table(rows);

  const pending = rows.filter((row) => row.status === "In Progress");
  const accepted = rows.filter((row) => row.status === "Accepted");
  const rejected = rows.filter((row) => row.status === "Rejected" || row.status === "Invalid");

  console.log(`Summary: ${accepted.length} accepted, ${pending.length} in progress, ${rejected.length} rejected/invalid.`);
  if (accepted.length > 0) {
    console.log("Staple accepted DMGs with: pnpm --filter @cadencr/desktop notarize:mac:staple");
  }
}

function fetchStatus(submission) {
  const result = spawnSync(
    "xcrun",
    ["notarytool", "info", submission.id, "--keychain-profile", NOTARY_PROFILE, "--output-format", "json"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    return {
      artifact: submission.artifact,
      id: submission.id,
      status: "Status check failed",
      message: result.stderr.trim(),
    };
  }

  const info = JSON.parse(result.stdout);
  return {
    artifact: basename(submission.artifact),
    id: submission.id,
    status: info.status,
    message: info.statusSummary ?? "",
  };
}
