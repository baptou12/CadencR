// Native loopback qualification of ONE prepared Pi archive on the machine running it.
// Extracts the canonical archive, runs the extracted `bin/provider` and an installed
// Pi through test/native-loopback.test.mjs (isolated loopback model, no credentials),
// and writes an evidence JSON without local paths. A run only counts for the target
// whose OS and architecture this Node build, the OS (Rosetta / `uname -m`) and, for
// `--environment hosted`, the GitHub runner variables all agree on. These are
// guards against operator mistakes, not attestations: a result on one OS never
// stands in for another, and `container`/`local` evidence is the operator's word.
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { release, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { CONNECTOR_VERSION } from "../src/version.mjs";
import { isMain } from "./entrypoint.mjs";
import { hostTarget, PREPARED_TARGETS } from "./targets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
// The evidence state each environment may claim (vocabulary: source-readiness.mjs).
export const ENVIRONMENT_EVIDENCE = Object.freeze({
  local: "native-loopback-qualified-local",
  container: "native-loopback-qualified-container",
  hosted: "native-loopback-qualified-hosted",
});
const OPTIONS = ["target", "archive", "pi", "environment", "evidence", "expect-archive-sha256"];
const UNAME_ARCH = { aarch64: "aarch64", arm64: "aarch64", x86_64: "x86_64", amd64: "x86_64" };
const RUNNER_OS = { darwin: "macOS", linux: "Linux" };
const RUNNER_ARCH = { aarch64: "ARM64", x86_64: "X64" };

export function parseQualifyArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]?.slice(2);
    if (!args[i]?.startsWith("--") || !OPTIONS.includes(name) || parsed[name] || !args[i + 1]) {
      throw new Error("Expected each qualification option exactly once");
    }
    parsed[name] = args[i + 1];
  }
  for (const name of ["target", "archive", "pi", "environment", "evidence"]) {
    if (!parsed[name]) throw new Error(`Missing --${name}`);
  }
  for (const name of ["archive", "pi", "evidence"]) {
    if (!isAbsolute(parsed[name])) throw new Error(`--${name} must be an absolute path`);
  }
  if (!PREPARED_TARGETS.includes(parsed.target)) throw new Error("Unprepared --target");
  if (!ENVIRONMENT_EVIDENCE[parsed.environment]) {
    throw new Error("--environment must be local, container or hosted");
  }
  const expected = parsed["expect-archive-sha256"];
  if (expected !== undefined && !/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error("--expect-archive-sha256 must be 64 lowercase hex characters");
  }
  return parsed;
}

// Facts about the machine running Node that Node's own platform/arch cannot show:
// whether macOS is translating this process (Rosetta) and the Linux kernel's machine.
// Absolute tool paths keep a planted PATH entry out of the probe.
export function detectHost(platform = process.platform, arch = process.arch, probe = spawnSync) {
  const host = { platform, arch, machine: undefined, translated: false };
  const ask = (tool, args) => {
    const result = probe(tool, args, { encoding: "utf8", timeout: 10_000 });
    if (result.error) throw new Error(`Cannot probe the host with ${tool}: ${result.error.code}`);
    return result;
  };
  if (platform === "darwin") {
    // Absent (non-zero) on Intel Macs, where nothing is ever translated.
    const result = ask("/usr/sbin/sysctl", ["-n", "sysctl.proc_translated"]);
    host.translated = result.status === 0 && result.stdout.trim() === "1";
  } else if (platform === "linux") {
    const result = ask("/usr/bin/uname", ["-m"]);
    if (result.status !== 0) throw new Error("Cannot probe the host with uname -m");
    host.machine = result.stdout.trim();
  }
  return host;
}

// A target is only qualified by a run on a machine of exactly that OS and architecture.
// Node's process.arch is the Node *build*, so Rosetta and a mismatched Linux kernel
// machine are checked separately.
export function assertHostMatchesTarget(target, host) {
  const nodeTarget = hostTarget(host.platform, host.arch);
  if (nodeTarget !== target) {
    throw new Error(`This Node build is ${nodeTarget} and cannot qualify ${target}`);
  }
  if (host.translated) {
    throw new Error(`Node runs under Rosetta translation; it cannot qualify ${target}`);
  }
  if (host.platform === "linux" && UNAME_ARCH[host.machine] !== target.split("-")[1]) {
    throw new Error(`Kernel machine ${host.machine} does not match ${target}`);
  }
}

// `--environment hosted` additionally requires the variables GitHub sets on its own
// runners, for this target's OS and architecture. They can be forged by whoever
// controls the shell, so this stops mistakes (a local or self-hosted run labelled
// hosted); the workflow run itself remains the evidence of record.
export function assertHostedRunner(target, env = process.env) {
  const [os, arch] = target.split("-");
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    env.RUNNER_OS !== RUNNER_OS[os] ||
    env.RUNNER_ARCH !== RUNNER_ARCH[arch]
  ) {
    throw new Error(
      `--environment hosted requires a GitHub-hosted ${RUNNER_OS[os]} ${RUNNER_ARCH[arch]} runner ` +
        "(GITHUB_ACTIONS, RUNNER_ENVIRONMENT, RUNNER_OS, RUNNER_ARCH)",
    );
  }
}

// Archive member names must stay inside the extraction directory.
export function assertSafeMembers(listing) {
  const names = listing.split("\n").filter(Boolean);
  if (names.length === 0) throw new Error("Empty archive");
  for (const name of names) {
    const parts = name.replace(/^\.\//, "").split("/");
    if (isAbsolute(name) || name.includes("\\") || parts.includes("..")) {
      throw new Error("Archive member escapes the extraction directory");
    }
  }
  return names;
}

export function summarizeTap(output) {
  const count = (label) => Number(new RegExp(`^# ${label} (\\d+)$`, "m").exec(output)?.[1] ?? NaN);
  const summary = {
    tests: count("tests"),
    pass: count("pass"),
    fail: count("fail"),
    skipped: count("skipped"),
  };
  const observed = /^# (Passed: .+)$/m.exec(output)?.[1];
  return { ...summary, observed };
}

async function payloadFiles(directory) {
  const files = {};
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        files[relative(directory, path).split("\\").join("/")] = {
          sha256: digest(await readFile(path)),
          mode: ((await stat(path)).mode & 0o777).toString(8),
        };
      } else throw new Error("Payload contains a non-regular file");
    }
  };
  await walk(directory);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
}

// The loopback conformance suite against the extracted provider and the installed Pi.
function runLoopback({ provider, pi, env }) {
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-reporter=tap", join(root, "test/native-loopback.test.mjs")],
    {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 300_000,
      env: {
        ...env,
        CADENCR_PI_NATIVE_TEST_COMMAND: pi,
        CADENCR_PI_NATIVE_TEST_PROVIDER: provider,
      },
    },
  );
  return { status: result.status, signal: result.signal, stdout: result.stdout ?? "" };
}

async function extractArchive(archive, payload) {
  await mkdir(payload);
  const listing = await run("tar", ["-tzf", archive], { maxBuffer: 1024 * 1024 });
  assertSafeMembers(listing.stdout);
  await run("tar", ["--no-same-owner", "-xzf", archive, "-C", payload]);
  const provider = join(payload, "bin/provider");
  await access(provider, constants.X_OK);
  return provider;
}

// Every selected loopback test must have run and passed (the count is not pinned: the
// suite may grow), and nothing may be skipped.
export const loopbackPassed = (loopback, status) =>
  status === 0 &&
  loopback.tests >= 1 &&
  loopback.pass === loopback.tests &&
  loopback.fail === 0 &&
  loopback.skipped === 0;

// Returns `{ evidence, scratch, retained }`. The scratch directory holds the extracted
// payload and is removed after a pass; on a failure it is kept and named in the error.
export async function qualify(options, deps = {}) {
  const { host = detectHost(), env: runnerEnv = process.env, loopback = runLoopback } = deps;
  assertHostMatchesTarget(options.target, host);
  if (options.environment === "hosted") assertHostedRunner(options.target, runnerEnv);
  const bytes = await readFile(options.archive);
  const sha256 = digest(bytes);
  if (options["expect-archive-sha256"] && options["expect-archive-sha256"] !== sha256) {
    throw new Error("Archive SHA-256 differs from the expected candidate digest");
  }
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "pi-qualify-")));
  try {
    const payload = join(scratch, "payload");
    const provider = await extractArchive(options.archive, payload);
    // Minimal allowlisted environment; the native test builds its own isolated child env.
    const env = {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      TMPDIR: process.env.TMPDIR ?? tmpdir(),
    };
    const probe = { env, timeout: 30_000 };
    const [pi, connectorOutput] = await Promise.all([
      run(options.pi, ["--version"], probe),
      run(provider, ["version"], probe),
    ]);
    const connector = connectorOutput.stdout.trim();
    const result = loopback({ provider, pi: await realpath(options.pi), env });
    const summary = summarizeTap(result.stdout);
    const passed = loopbackPassed(summary, result.status) && connector === CONNECTOR_VERSION;
    const evidence = {
      schema_version: 1,
      kind: "pi-native-loopback-qualification",
      result: passed ? "passed" : "failed",
      target: options.target,
      evidence_state: passed ? ENVIRONMENT_EVIDENCE[options.environment] : "not-qualified",
      environment: options.environment,
      host: {
        platform: host.platform,
        arch: host.arch,
        machine: host.machine ?? null,
        rosetta_translated: host.translated,
        os_release: release(),
      },
      ...(options.environment === "hosted" && {
        runner: {
          environment: runnerEnv.RUNNER_ENVIRONMENT,
          os: runnerEnv.RUNNER_OS,
          arch: runnerEnv.RUNNER_ARCH,
        },
      }),
      runtime: { node: process.version, pi: pi.stdout.trim(), connector },
      archive: { name: basename(options.archive), sha256, size: bytes.length },
      payload: await payloadFiles(payload),
      native_loopback: { ...summary, exit_status: result.status, signal: result.signal },
      uses_personal_credentials: false,
      managed_installation: "not-qualified",
      generated_at: new Date().toISOString(),
    };
    await writeFile(options.evidence, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
    if (passed) await rm(scratch, { recursive: true, force: true });
    return { evidence, scratch, retained: !passed };
  } catch (error) {
    throw new Error(`${error.message} (scratch retained at ${scratch})`, { cause: error });
  }
}

if (isMain(import.meta.url)) {
  try {
    const { evidence, scratch, retained } = await qualify(parseQualifyArgs(process.argv.slice(2)));
    process.stdout.write(
      `${evidence.result} ${evidence.target} archive=${evidence.archive.sha256}\n`,
    );
    if (retained) process.stderr.write(`Scratch retained for private inspection: ${scratch}\n`);
    process.exitCode = evidence.result === "passed" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`pi qualification: ${error.message}\n`);
    process.exitCode = 1;
  }
}
