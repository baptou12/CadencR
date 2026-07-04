import { accessSync, constants } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";

const command = process.argv[2];
const args = process.argv.slice(3);

if (!command) {
  console.error("Usage: node scripts/cargo-env.mjs <command> [...args]");
  process.exit(1);
}

const env = { ...process.env };

delete env.CARGO_TARGET_DIR;

if (!env.RUSTC_WRAPPER) {
  const sccachePath = findSccache(env.PATH ?? "");
  if (sccachePath) {
    env.RUSTC_WRAPPER = sccachePath;
  }
}

if (usesSccache(env.RUSTC_WRAPPER)) {
  env.CARGO_INCREMENTAL ??= "0";
}

const result = spawnSync(command, args, {
  stdio: "inherit",
  env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);

function findSccache(pathValue) {
  const candidates = new Set([
    "/opt/homebrew/bin/sccache",
    ...pathValue.split(":").filter(Boolean).map((entry) => join(entry, "sccache")),
  ]);

  for (const candidate of candidates) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function usesSccache(wrapper) {
  return wrapper !== undefined && basename(wrapper) === "sccache";
}
