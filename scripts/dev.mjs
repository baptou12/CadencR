import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  collectDevProcessGroups,
  readProcessRows,
  signalGroups,
  stopDevProcessGroups,
} from "./dev-cleanup.mjs";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cargoEnvScript = path.join(repoRoot, "scripts", "cargo-env.mjs");
const turboArgs = ["turbo", "run", "dev", ...process.argv.slice(2)];
const child = spawn(process.execPath, [cargoEnvScript, ...turboArgs], {
  cwd: repoRoot,
  detached: true,
  stdio: "inherit",
});

let stopping = false;
const observedGroups = new Set();

const childExitPromise = new Promise((resolve) => {
  child.on("exit", (code, signal) => {
    resolve({ code, signal });
  });
});

observeChildGroups();
const observeInterval = setInterval(observeChildGroups, 500);
observeInterval.unref();

child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

process.on("SIGINT", () => {
  void stopFromSignal("SIGINT");
});
process.on("SIGTERM", () => {
  void stopFromSignal("SIGTERM");
});

const exit = await childExitPromise;
clearInterval(observeInterval);
if (!stopping) {
  await stopDevProcessGroups([...observedGroups]);
  process.exit(exitCodeForChild(exit));
}

async function stopFromSignal(signal) {
  if (stopping) {
    await stopDevProcessGroups([...observedGroups], 0);
    process.exit(exitCodeForSignal(signal));
  }

  stopping = true;
  clearInterval(observeInterval);
  observeChildGroups();
  signalChildGroup(signal);
  await Promise.race([childExitPromise, delay(1_500)]);
  await stopDevProcessGroups([...observedGroups]);
  process.exit(exitCodeForSignal(signal));
}

function signalChildGroup(signal) {
  if (child.pid === undefined) return;
  signalGroups([child.pid], signal);
}

function observeChildGroups() {
  if (child.pid === undefined) return;
  const groups = collectDevProcessGroups(readProcessRows(), repoRoot, process.pid, child.pid);
  for (const group of groups) observedGroups.add(group);
}

function exitCodeForChild(exit) {
  if (exit.code !== null) return exit.code;
  return exitCodeForSignal(exit.signal);
}

function exitCodeForSignal(signal) {
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  return 1;
}
