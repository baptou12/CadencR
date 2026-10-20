#!/usr/bin/env node
// The Port monitor's native backend (docs/CUSTOM_TABS.md §4.7). Cadencr starts
// it with `node backend/server.mjs` from the tab folder on the tab's first
// `client.backend.request()`, and stops it when the tab closes.
//
// It does what a page cannot: run `lsof`/`netstat` and send a signal to a
// process. It runs with your user rights — which is why it refuses to stop
// anything running outside this conversation's folder. A folder is not a
// conversation: conversations without their own worktree share the project
// folder, and its processes.
//
// Protocol: JSON lines. stdin: one `hello`, then `request`s. stdout: one
// `response` per request, nothing else. stderr: the log Cadencr shows in the
// tab's Activity. stdin closing means "exit".
import { isAbsolute, relative } from "node:path";
import { createInterface } from "node:readline";

import { listPorts } from "./ports.mjs";

let hello = null;

const log = (...parts) => console.error("[port-monitor]", ...parts);
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

class MethodError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** The Cadencr API, with the backend's own token: the tab's permissions only. */
async function cadencr(path) {
  const response = await fetch(hello.api.base_url + path, {
    headers: { [hello.api.token_header]: hello.api.token },
  });
  if (!response.ok) {
    throw new MethodError("CADENCR_API", `Cadencr answered ${response.status} for ${path}`);
  }
  return response.json();
}

function insideFolder(cwd) {
  if (!cwd) return null;
  const path = relative(hello.worktree, cwd);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function ports() {
  const entries = await listPorts();
  return {
    checkedAt: new Date().toISOString(),
    ports: entries.map((entry) => ({ ...entry, inFolder: insideFolder(entry.cwd) })),
  };
}

const METHODS = {
  /** The conversation, read through the Cadencr API (`features:read`). */
  async context() {
    const feature = await cadencr(`/api/features/${hello.feature_id}`);
    return { title: feature.title, worktree: hello.worktree, platform: process.platform };
  },
  ports,
  /** SIGTERM to a process listening right now, running in this conversation's folder. */
  async stop(params) {
    const pid = Number(params?.pid);
    const { ports: current } = await ports();
    const target = current.find((entry) => entry.pid === pid);
    if (!target) throw new MethodError("NOT_LISTENING", `Process ${pid} is not listening on a port`);
    if (target.inFolder !== true) {
      throw new MethodError(
        "OUTSIDE_FOLDER",
        `Process ${pid} (${target.command}) is not running in this conversation's folder`,
      );
    }
    process.kill(pid, "SIGTERM");
    log(`sent SIGTERM to ${pid} (${target.command}) on port ${target.port}`);
    return { stopped: pid };
  },
};

async function handle({ id, method, params }) {
  const run = METHODS[method];
  if (!Object.hasOwn(METHODS, method) || typeof run !== "function") {
    send({ type: "response", id, error: { code: "UNKNOWN_METHOD", message: `No method ${method}` } });
    return;
  }
  try {
    send({ type: "response", id, result: await run(params) });
  } catch (error) {
    log(`${method} failed:`, error.message);
    send({
      type: "response",
      id,
      error: { code: typeof error.code === "string" ? error.code : "BACKEND_ERROR", message: error.message },
    });
  }
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    log("ignored a line that is not JSON");
    return;
  }
  if (message.type === "hello") {
    hello = message;
    log(`ready for conversation ${hello.feature_id} in ${hello.worktree}`);
    return;
  }
  if (message.type === "request") void handle(message);
});
lines.on("close", () => {
  log("stdin closed; exiting");
  process.exit(0);
});
