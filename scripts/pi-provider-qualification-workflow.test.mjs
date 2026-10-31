import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";
import { PI_VERSION, PREPARED_TARGETS } from "../plugins/providers/pi/scripts/targets.mjs";

const workflowsDir = new URL("../.github/workflows/", import.meta.url);
const name = "pi-provider-qualification.yml";
const text = readFileSync(new URL(name, workflowsDir), "utf8");
const workflow = parse(text);
const { package: pack, qualify } = workflow.jobs;
const steps = (job) => job.steps;
const runs = (job) =>
  steps(job)
    .map((step) => step.run ?? "")
    .join("\n");

test("qualification is manual, read-only and credential-free", () => {
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  for (const job of Object.values(workflow.jobs)) assert.equal(job.permissions, undefined);
  assert.doesNotMatch(
    text,
    /secrets\.|contents: write|id-token|pull_request|schedule:|environment:/,
  );
  for (const job of [pack, qualify]) {
    for (const step of steps(job).filter((s) => s.uses?.startsWith("actions/checkout@"))) {
      assert.equal(step.with["persist-credentials"], false);
      assert.equal(step.with.ref, "${{ github.sha }}");
    }
  }
});

test("actions use the exact commit SHAs the repository's other workflows already pin", () => {
  const others = new Map();
  for (const file of readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") && f !== name)) {
    for (const match of readFileSync(new URL(file, workflowsDir), "utf8").matchAll(
      /uses:\s*(actions\/[a-z-]+)@([0-9a-f]{40})/g,
    )) {
      others.set(match[1], (others.get(match[1]) ?? new Set()).add(match[2]));
    }
  }
  const used = [pack, qualify].flatMap(steps).filter((step) => step.uses);
  assert.ok(used.length >= 6);
  for (const step of used) {
    const [action, sha] = step.uses.split("@");
    assert.match(sha, /^[0-9a-f]{40}$/, step.uses);
    assert.ok(others.get(action)?.has(sha), `${step.uses} is not pinned elsewhere in the repo`);
  }
  for (const step of used.filter((s) => s.uses.startsWith("actions/setup-node@"))) {
    assert.equal(step.with["node-version-file"], ".nvmrc");
    assert.equal(step.with["node-version"], undefined);
  }
});

// Maps a GitHub runner label to the registry target it runs: ubuntu-*-arm and macOS
// images without an -intel/-large suffix are arm64; the others are x86_64.
function runnerTarget(label) {
  const os = label.startsWith("ubuntu-") ? "linux" : label.startsWith("macos-") ? "darwin" : null;
  assert.ok(os, `unknown runner OS: ${label}`);
  const intel = os === "linux" ? !label.endsWith("-arm") : /-(intel|large)$/.test(label);
  return `${os}-${intel ? "x86_64" : "aarch64"}`;
}

test("each native job runs on the OS and architecture of the target it qualifies", () => {
  const readiness = JSON.parse(
    readFileSync(new URL("../plugins/providers/pi/readiness.json", import.meta.url), "utf8"),
  );
  const matrix = qualify.strategy.matrix.include;
  assert.equal(qualify.strategy["fail-fast"], false);
  assert.equal(qualify["runs-on"], "${{ matrix.runner }}");
  assert.deepEqual(qualify.needs, "package");
  assert.equal(pack["runs-on"], "ubuntu-24.04");
  for (const entry of matrix) {
    assert.ok(PREPARED_TARGETS.includes(entry.target), entry.target);
    assert.equal(runnerTarget(entry.runner), entry.target, `${entry.runner} cannot qualify`);
  }
  assert.equal(new Set(matrix.map((e) => e.target)).size, matrix.length);
  // Whatever still awaits a hosted run must be covered by the matrix.
  const awaiting = PREPARED_TARGETS.filter(
    (t) => readiness.targets[t].evidence === "pending-hosted-run",
  );
  for (const target of awaiting) {
    assert.ok(
      matrix.some((e) => e.target === target),
      `${target} awaits a hosted run`,
    );
  }
});

test("the package job packs every prepared target with the pinned released CLI", () => {
  const script = runs(pack);
  assert.match(script, /fetch-released-cli\.sh[\s\S]*scripts\/cli-qualification\.env/);
  for (const target of PREPARED_TARGETS) assert.ok(script.includes(target), target);
  assert.match(script, /require\(process\.argv\[1\]\)\.archive\.name/);
  assert.doesNotMatch(script, /pi-\d+\.\d+\.\d+-/, "archive names come from candidate.json");
  assert.match(script, /--source-commit "\$SOURCE_COMMIT"/);
  assert.match(
    script,
    /sort -u \| wc -l\)" -eq 1/,
    "payload must be byte-identical across targets",
  );
});

test("each native job qualifies the packed archive with pinned Pi and uploads evidence always", () => {
  const script = runs(qualify);
  assert.equal(workflow.env.PI_VERSION, PI_VERSION);
  assert.match(script, /--ignore-scripts/);
  assert.match(script, /qualify-native\.mjs/);
  assert.match(script, /--environment hosted/);
  assert.match(script, /--expect-archive-sha256 "\$expected"/);
  const upload = steps(qualify).at(-1);
  assert.ok(upload.uses.startsWith("actions/upload-artifact@"));
  assert.equal(upload.if, "${{ always() }}");
  assert.match(upload.with.name, /pi-qualification-\$\{\{ matrix\.target \}\}/);
});

test("the candidate handoff survives re-running only the failed qualify jobs", () => {
  const upload = steps(pack).find((s) => s.uses?.startsWith("actions/upload-artifact@"));
  const download = steps(qualify).find((s) => s.uses?.startsWith("actions/download-artifact@"));
  assert.equal(upload.with.name, download.with.name);
  assert.doesNotMatch(upload.with.name, /run_attempt/);
  assert.equal(upload.with.overwrite, true);
  // Evidence from each attempt stays distinct.
  const evidence = steps(qualify).at(-1);
  assert.match(evidence.with.name, /run_attempt/);
});
