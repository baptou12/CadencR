import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CONNECTOR_VERSION } from "../src/version.mjs";
import { isMain } from "../scripts/entrypoint.mjs";
import { candidateInput } from "../scripts/qualification-input.mjs";
import {
  assertHostMatchesTarget,
  assertHostedRunner,
  assertSafeMembers,
  detectHost,
  ENVIRONMENT_EVIDENCE,
  loopbackPassed,
  parseQualifyArgs,
  qualify,
  summarizeTap,
} from "../scripts/qualify-native.mjs";
import { QUALIFIED_EVIDENCE, TARGET_EVIDENCE } from "../scripts/source-readiness.mjs";
import {
  hostTarget,
  NOT_PREPARED_TARGETS,
  PI_VERSION,
  PREPARED_TARGETS,
} from "../scripts/targets.mjs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url));

test("host detection maps every supported macOS and Linux platform/arch pair", () => {
  assert.equal(hostTarget("darwin", "arm64"), "darwin-aarch64");
  assert.equal(hostTarget("darwin", "x64"), "darwin-x86_64");
  assert.equal(hostTarget("linux", "arm64"), "linux-aarch64");
  assert.equal(hostTarget("linux", "x64"), "linux-x86_64");
  for (const [platform, arch] of [
    ["win32", "x64"],
    ["win32", "arm64"],
    ["linux", "ia32"],
    ["freebsd", "x64"],
  ]) {
    assert.throws(() => hostTarget(platform, arch), /Unsupported qualification host/);
  }
  assert.deepEqual(
    PREPARED_TARGETS.filter((t) => NOT_PREPARED_TARGETS.includes(t)),
    [],
  );
  assert.ok(NOT_PREPARED_TARGETS.every((t) => t.startsWith("windows-")));
});

const host = (platform, arch, extra = {}) => ({
  platform,
  arch,
  machine: platform === "linux" ? (arch === "arm64" ? "aarch64" : "x86_64") : undefined,
  translated: false,
  ...extra,
});

test("a run qualifies only the target its Node build, OS and kernel agree on", () => {
  assertHostMatchesTarget("darwin-aarch64", host("darwin", "arm64"));
  assertHostMatchesTarget("darwin-x86_64", host("darwin", "x64"));
  assertHostMatchesTarget("linux-aarch64", host("linux", "arm64"));
  assertHostMatchesTarget("linux-x86_64", host("linux", "x64"));
  assert.throws(
    () => assertHostMatchesTarget("linux-aarch64", host("darwin", "arm64")),
    /cannot qualify/,
  );
  assert.throws(
    () => assertHostMatchesTarget("darwin-aarch64", host("linux", "arm64")),
    /cannot qualify/,
  );
  assert.throws(
    () => assertHostMatchesTarget("linux-x86_64", host("linux", "arm64")),
    /cannot qualify/,
  );
});

test("an x64 Node translated by Rosetta cannot qualify an Intel macOS target", () => {
  assert.throws(
    () => assertHostMatchesTarget("darwin-x86_64", host("darwin", "x64", { translated: true })),
    /Rosetta/,
  );
});

test("a Linux kernel machine that differs from the target is refused", () => {
  assert.throws(
    () => assertHostMatchesTarget("linux-x86_64", host("linux", "x64", { machine: "aarch64" })),
    /Kernel machine aarch64/,
  );
  assert.throws(
    () => assertHostMatchesTarget("linux-aarch64", host("linux", "arm64", { machine: "x86_64" })),
    /Kernel machine x86_64/,
  );
  assert.throws(
    () => assertHostMatchesTarget("linux-aarch64", host("linux", "arm64", { machine: "riscv64" })),
    /Kernel machine/,
  );
  assertHostMatchesTarget("linux-aarch64", host("linux", "arm64", { machine: "arm64" }));
  assertHostMatchesTarget("linux-x86_64", host("linux", "x64", { machine: "amd64" }));
});

test("host probing reads Rosetta on macOS and uname on Linux, and fails loudly otherwise", () => {
  const answer =
    (stdout, status = 0) =>
    () => ({ status, stdout });
  assert.equal(detectHost("darwin", "x64", answer("1\n")).translated, true);
  assert.equal(detectHost("darwin", "arm64", answer("0\n")).translated, false);
  // The sysctl key does not exist on Intel Macs.
  assert.equal(detectHost("darwin", "x64", answer("", 1)).translated, false);
  assert.equal(detectHost("linux", "arm64", answer("aarch64\n")).machine, "aarch64");
  assert.throws(() => detectHost("linux", "x64", answer("", 1)), /uname -m/);
  const missing = () => ({ error: { code: "ENOENT" } });
  assert.throws(() => detectHost("darwin", "arm64", missing), /ENOENT/);
  assert.throws(() => detectHost("linux", "arm64", missing), /ENOENT/);
});

test("hosted evidence needs a GitHub-hosted runner of the target's OS and architecture", () => {
  const runner = (os, arch) => ({
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    RUNNER_OS: os,
    RUNNER_ARCH: arch,
  });
  assertHostedRunner("linux-x86_64", runner("Linux", "X64"));
  assertHostedRunner("linux-aarch64", runner("Linux", "ARM64"));
  assertHostedRunner("darwin-x86_64", runner("macOS", "X64"));
  assertHostedRunner("darwin-aarch64", runner("macOS", "ARM64"));
  for (const [target, env] of [
    ["linux-x86_64", {}],
    ["linux-x86_64", { ...runner("Linux", "X64"), GITHUB_ACTIONS: "false" }],
    ["linux-x86_64", { ...runner("Linux", "X64"), RUNNER_ENVIRONMENT: "self-hosted" }],
    ["linux-x86_64", runner("Linux", "ARM64")],
    ["linux-aarch64", runner("macOS", "ARM64")],
    ["darwin-x86_64", runner("macOS", "ARM64")],
  ]) {
    assert.throws(() => assertHostedRunner(target, env), /GitHub-hosted/);
  }
});

test("the loopback result is judged by its own counts, not a pinned test total", () => {
  const ok = (tests) => ({ tests, pass: tests, fail: 0, skipped: 0 });
  assert.ok(loopbackPassed(ok(1), 0));
  assert.ok(loopbackPassed(ok(5), 0));
  assert.ok(!loopbackPassed(ok(0), 0), "no test ran");
  assert.ok(!loopbackPassed(ok(2), 1));
  assert.ok(!loopbackPassed({ tests: 3, pass: 2, fail: 1, skipped: 0 }, 0));
  assert.ok(!loopbackPassed({ tests: 3, pass: 2, fail: 0, skipped: 1 }, 0));
  assert.ok(!loopbackPassed(summarizeTap("garbage"), 0));
});

test("qualification arguments are explicit, absolute and bounded", () => {
  const valid = [
    "--target",
    "linux-aarch64",
    "--archive",
    "/a.tar.gz",
    "--pi",
    "/pi",
    "--environment",
    "container",
    "--evidence",
    "/e.json",
  ];
  assert.equal(parseQualifyArgs(valid).target, "linux-aarch64");
  for (const bad of [
    valid.slice(2),
    [...valid, "--target", "darwin-aarch64"],
    valid.map((v) => (v === "linux-aarch64" ? "windows-x86_64" : v)),
    valid.map((v) => (v === "container" ? "ci" : v)),
    valid.map((v) => (v === "/pi" ? "pi" : v)),
    [...valid, "--expect-archive-sha256", "ABC"],
    [...valid, "--surprise", "x"],
  ]) {
    assert.throws(() => parseQualifyArgs(bad));
  }
});

test("archive members cannot escape the extraction directory", () => {
  assert.deepEqual(assertSafeMembers("bin/provider\nREADME.md\n"), ["bin/provider", "README.md"]);
  for (const listing of ["", "/etc/passwd\n", "../x\n", "bin/../../x\n", "bin\\x\n"]) {
    assert.throws(() => assertSafeMembers(listing));
  }
});

test("TAP summaries expose counts and the observed native scope", () => {
  const output =
    "TAP version 13\n# Passed: discovery, resume\n# tests 2\n# pass 2\n# fail 0\n# skipped 0\n";
  assert.deepEqual(summarizeTap(output), {
    tests: 2,
    pass: 2,
    fail: 0,
    skipped: 0,
    observed: "Passed: discovery, resume",
  });
  assert.ok(Number.isNaN(summarizeTap("garbage").pass));
});

test("each environment can only claim its own qualified evidence state", () => {
  assert.deepEqual(Object.values(ENVIRONMENT_EVIDENCE).sort(), [...QUALIFIED_EVIDENCE].sort());
  assert.ok(QUALIFIED_EVIDENCE.every((state) => TARGET_EVIDENCE.includes(state)));
});

test("candidate input declares exactly one target with the shared placeholder URL", () => {
  const template = JSON.parse(read("package-template.json"));
  for (const target of PREPARED_TARGETS) {
    const input = candidateInput(template, target);
    assert.deepEqual(Object.keys(input.agent.distribution.binary), [target]);
    assert.equal(
      input.agent.distribution.binary[target].archive,
      `https://example.invalid/pi-${template.package.agent.version}-${target}.tar.gz`,
    );
    assert.equal(input.agent.distribution.binary[target].cmd, "bin/provider");
    assert.deepEqual(input.host, template.package.host);
  }
  assert.throws(() => candidateInput(template, "windows-x86_64"), /Unprepared target/);
});

test("launcher source is portable across macOS and Linux", () => {
  const launcher = read("src/provider.mjs").toString("utf8");
  assert.ok(launcher.startsWith("#!/usr/bin/env node\n"), "shebang must resolve node via PATH");
  assert.ok(!launcher.includes("\r"), "CR bytes would corrupt the Linux shebang line");
});

test("entrypoints run through a symlinked path instead of silently doing nothing", async (t) => {
  // macOS /tmp and /var are symlinks, and Linux checkouts may be too.
  const { mkdtemp, symlink } = await import("node:fs/promises");
  const { spawnSync } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const base = await mkdtemp(join(tmpdir(), "pi-symlinked-entry-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const link = join(base, "scripts");
  await symlink(new URL("../scripts", import.meta.url).pathname, link);
  for (const script of ["qualification-input.mjs", "qualify-native.mjs", "prepare-candidate.mjs"]) {
    const result = spawnSync(process.execPath, [join(link, script)], { encoding: "utf8" });
    assert.equal(result.status, 1, `${script} must report its usage error`);
    assert.ok(result.stderr.length > 0, `${script} must not fail silently`);
  }
});

// qualify() end to end with a stand-in archive, Pi and loopback runner: the real native
// suite needs a real Pi and is exercised by the scripted qualification itself.
async function qualifyFixture(piVersion) {
  const base = await mkdtemp(join(tmpdir(), "pi-qualify-test-"));
  await mkdir(join(base, "tree/bin"), { recursive: true });
  const provider = join(base, "tree/bin/provider");
  await writeFile(provider, `#!/bin/sh\necho ${CONNECTOR_VERSION}\n`);
  await chmod(provider, 0o755);
  const pi = join(base, "pi");
  await writeFile(pi, `#!/bin/sh\necho ${piVersion}\n`);
  await chmod(pi, 0o755);
  const archive = join(base, "pi.tar.gz");
  const packed = spawnSync("tar", ["-czf", archive, "-C", join(base, "tree"), "bin"]);
  assert.equal(packed.status, 0);
  const options = {
    target: "linux-aarch64",
    archive,
    pi,
    environment: "container",
    evidence: join(base, "evidence.json"),
  };
  const deps = (stdout, status = 0) => ({
    host: host("linux", "arm64"),
    loopback: () => ({ status, signal: null, stdout }),
  });
  return { base, options, deps };
}

const tap = (tests, pass = tests) =>
  `# tests ${tests}\n# pass ${pass}\n# fail ${tests - pass}\n# skipped 0\n`;

test("a passing qualification records evidence and removes its scratch directory", async (t) => {
  const { base, options, deps } = await qualifyFixture(PI_VERSION);
  t.after(() => rm(base, { recursive: true, force: true }));
  const { evidence, scratch, retained } = await qualify(options, deps(tap(3)));
  assert.equal(evidence.result, "passed");
  assert.equal(evidence.evidence_state, "native-loopback-qualified-container");
  assert.equal(evidence.runtime.pi, PI_VERSION);
  assert.equal(evidence.host.machine, "aarch64");
  assert.equal(evidence.runner, undefined);
  assert.equal(retained, false);
  assert.ok(!existsSync(scratch), "scratch must be removed after a pass");
  assert.equal(JSON.parse(await readFile(options.evidence, "utf8")).result, "passed");
});

test("a failing qualification keeps its scratch directory and says where", async (t) => {
  const { base, options, deps } = await qualifyFixture(PI_VERSION);
  const { evidence, scratch, retained } = await qualify(options, deps(tap(3, 2), 1));
  t.after(() => Promise.all([base, scratch].map((p) => rm(p, { recursive: true, force: true }))));
  assert.equal(evidence.result, "failed");
  assert.equal(evidence.evidence_state, "not-qualified");
  assert.equal(retained, true);
  assert.ok(existsSync(join(scratch, "payload/bin/provider")));
});

test("an error after extraction names the retained scratch directory", async (t) => {
  const { base, options, deps } = await qualifyFixture(PI_VERSION);
  t.after(() => rm(base, { recursive: true, force: true }));
  await writeFile(options.evidence, "{}\n");
  await assert.rejects(qualify(options, deps(tap(3))), (error) => {
    const scratch = /scratch retained at (.+)\)$/.exec(error.message)?.[1];
    assert.ok(scratch && existsSync(scratch), error.message);
    t.after(() => rm(scratch, { recursive: true, force: true }));
    return true;
  });
});

test("a host, kernel or hosted-runner mismatch is refused before the archive is read", async (t) => {
  const { base, options, deps } = await qualifyFixture(PI_VERSION);
  t.after(() => rm(base, { recursive: true, force: true }));
  const missing = { ...options, archive: "/nonexistent/pi.tar.gz" };
  await assert.rejects(
    qualify(missing, { ...deps(tap(1)), host: host("linux", "x64") }),
    /cannot qualify/,
  );
  await assert.rejects(
    qualify({ ...missing, environment: "hosted" }, { ...deps(tap(1)), env: {} }),
    /GitHub-hosted/,
  );
});

test("isMain compares the resolved argv path so symlinked invocations still run", async () => {
  const { symlink } = await import("node:fs/promises");
  const { pathToFileURL } = await import("node:url");
  const base = await mkdtemp(join(tmpdir(), "pi-ismain-"));
  const target = join(base, "real.mjs");
  const link = join(base, "link.mjs");
  await writeFile(target, "");
  await symlink(target, link);
  const real = pathToFileURL(await realpath(target)).href;
  assert.ok(isMain(real, link));
  assert.ok(isMain(real, target));
  assert.ok(!isMain(real, undefined));
  assert.ok(!isMain(pathToFileURL(join(base, "other.mjs")).href, link));
  await rm(base, { recursive: true, force: true });
});
