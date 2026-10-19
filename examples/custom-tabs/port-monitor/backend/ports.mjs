// The TCP ports listening on this computer and the process behind each:
// `lsof` on macOS and Linux, `netstat` + `tasklist` on Windows. Plain Node, no
// dependencies: the backend runs from the tab folder as is.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_BUFFER = 8 * 1024 * 1024;

/** `lsof` exits 1 when nothing matched: an empty answer, not a failure. */
async function lsof(args) {
  try {
    return (await run("lsof", args, { maxBuffer: MAX_BUFFER })).stdout;
  } catch (error) {
    if (error.code === 1 && !error.stderr) return "";
    if (error.code === "ENOENT") {
      throw Object.assign(new Error("lsof is not installed; the port list needs it"), {
        code: "LSOF_MISSING",
      });
    }
    throw error;
  }
}

/** `lsof -F` output: one field per line, a `p` line starting each process. */
function parseFields(stdout, onField) {
  let pid = null;
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const field = line[0];
    const value = line.slice(1);
    if (field === "p") pid = Number(value);
    if (pid !== null) onField(pid, field, value);
  }
}

/** `*:5005`, `127.0.0.1:1420`, `[::1]:3000` → `{ address, port }`. */
function splitAddress(name) {
  const colon = name.lastIndexOf(":");
  const port = Number(name.slice(colon + 1));
  return Number.isInteger(port) ? { address: name.slice(0, colon), port } : null;
}

async function listUnix() {
  const processes = new Map();
  const listening = [];
  parseFields(await lsof(["-nP", "-iTCP", "-sTCP:LISTEN", "-FpcLn"]), (pid, field, value) => {
    const process = processes.get(pid) ?? { pid, command: "", user: null };
    processes.set(pid, process);
    if (field === "c") process.command = value;
    if (field === "L") process.user = value;
    if (field === "n") {
      const split = splitAddress(value);
      if (split) listening.push({ pid, ...split });
    }
  });
  const cwds = new Map();
  if (processes.size > 0) {
    const pids = [...processes.keys()].join(",");
    parseFields(await lsof(["-a", "-d", "cwd", "-p", pids, "-Fpn"]), (pid, field, value) => {
      if (field === "n") cwds.set(pid, value);
    });
  }
  return { listening, processes, cwds };
}

async function listWindows() {
  const [{ stdout }, { stdout: v6 }, { stdout: tasks }] = await Promise.all([
    run("netstat", ["-ano", "-p", "TCP"], { maxBuffer: MAX_BUFFER }),
    run("netstat", ["-ano", "-p", "TCPv6"], { maxBuffer: MAX_BUFFER }),
    run("tasklist", ["/FO", "CSV", "/NH"], { maxBuffer: MAX_BUFFER }),
  ]);
  const listening = [];
  for (const line of `${stdout}\n${v6}`.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns[0] !== "TCP" || columns[3] !== "LISTENING") continue;
    const split = splitAddress(columns[1]);
    if (split) listening.push({ pid: Number(columns[4]), ...split });
  }
  const processes = new Map();
  for (const line of tasks.split(/\r?\n/)) {
    const [image, pid] = line.split('","').map((cell) => cell.replaceAll('"', ""));
    if (image && pid) processes.set(Number(pid), { pid: Number(pid), command: image, user: null });
  }
  // Windows does not tell another process's working directory.
  return { listening, processes, cwds: new Map() };
}

/**
 * One entry per (process, port), its addresses merged, sorted by port.
 * `cwd` is null where the platform cannot tell it.
 */
export async function listPorts() {
  const { listening, processes, cwds } =
    process.platform === "win32" ? await listWindows() : await listUnix();
  const entries = new Map();
  for (const { pid, address, port } of listening) {
    const key = `${pid}:${port}`;
    const entry = entries.get(key) ?? {
      port,
      pid,
      command: processes.get(pid)?.command ?? "",
      user: processes.get(pid)?.user ?? null,
      cwd: cwds.get(pid) ?? null,
      addresses: [],
    };
    if (!entry.addresses.includes(address)) entry.addresses.push(address);
    entries.set(key, entry);
  }
  return [...entries.values()].sort((a, b) => a.port - b.port || a.pid - b.pid);
}
