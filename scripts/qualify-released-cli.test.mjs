import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
  rmSync,
  realpathSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";

const script = new URL("./qualify-released-cli.sh", import.meta.url).pathname;
const pins = new URL("./cli-qualification.env", import.meta.url);
const workflow = new URL("../.github/workflows/cli-qualification.yml", import.meta.url);

test("offline qualification rejects unverified executables before execution or workspace creation", (t) => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "cli-qualification-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const marker = path.join(root, "executed");
  const binary = path.join(root, "cadencr");
  writeFileSync(binary, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
  const work = path.join(root, "work");
  const run = (cli, extra = {}) =>
    spawnSync("sh", [script], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, CLI: cli, CLI_WORK_ROOT: work, ...extra },
    });
  assert.match(run(binary).stderr, /digest mismatch/);
  assert.equal(existsSync(marker), false);
  assert.equal(existsSync(work), false);
  const link = path.join(root, "link");
  symlinkSync(binary, link);
  assert.match(run(link).stderr, /non-symlink/);
  assert.match(
    run(binary, { CADENCR_REGISTRY_GITHUB_TOKEN: "not-a-real-token" }).stderr,
    /token forbidden/,
  );
  assert.match(run(binary, { GITHUB_TOKEN: "not-a-real-token" }).stderr, /token forbidden/);
  assert.match(run(binary, { GH_TOKEN: "not-a-real-token" }).stderr, /token forbidden/);
  assert.equal(existsSync(work), false);
});

test("offline qualification uses separate pins and never uploads generated keys", () => {
  assert.equal(
    readFileSync(pins, "utf8")
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .join("\n"),
    "CADENCR_RELEASE_VERSION=0.13.0\nCADENCR_RELEASE_SHA256=d3223e3b3ff74543595fd3354c3249f50fa01def65f376a624eb1fbc8072df2a",
  );
  const yaml = readFileSync(workflow, "utf8");
  assert.match(yaml, /scripts\/cli-qualification\.env "\$CLI_ROOT"/);
  assert.doesNotMatch(yaml, /ci\/released-cli\.env/);
  assert.match(yaml, /runs-on: ubuntu-24\.04/);
  assert.match(yaml, /contents: read/);
  assert.match(yaml, /persist-credentials: false/);
  assert.match(yaml, /sudo unshare --net -- setpriv/);
  assert.match(yaml, /--bounding-set=-all --no-new-privs/);
  assert.match(readFileSync(script, "utf8"), /value.get\('code'\)!=sys.argv\[2\]/);
  assert.match(
    yaml,
    /path: \$\{\{ runner.temp \}\}\/cli-offline-qualification\/evidence\/evidence.json/,
  );
  assert.doesNotMatch(yaml, /secrets\.|cargo|pull_request|schedule:|contents: write/);
  const shell = readFileSync(script, "utf8");
  assert.match(shell, /env -i PATH=/);
  assert.match(shell, /lifecycle_qualified':False/);
  assert.match(shell, /interruption_resume':'pending'/);
  assert.match(shell, /renewal':'pending'/);
  assert.doesNotMatch(
    shell,
    /registry (publish-registry|mirror-publication|promote-publication|advance-catalog)/,
  );
  assert.match(shell, /timeout --kill-after=2s 30s/);
  assert.match(shell, /ulimit -f 128/);
});

test("reviewed pin input is strictly bounded before executable invocation", (t) => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "cli-reviewed-pins-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binary = path.join(root, "cadencr");
  writeFileSync(binary, "\x7fELFinert fixture", { mode: 0o700 });
  const pin = path.join(root, "pins.env");
  const run = (content) => {
    writeFileSync(pin, content);
    return spawnSync("sh", [script], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        CLI: binary,
        CLI_WORK_ROOT: path.join(root, "work"),
        CLI_QUALIFICATION_PINS: pin,
      },
    });
  };
  const digest = "a".repeat(64);
  for (const content of [
    "CADENCR_RELEASE_VERSION=0.13.1-dev.39108033875.1\nCADENCR_RELEASE_SHA256=bad",
    `CADENCR_RELEASE_VERSION=00.99.0\nCADENCR_RELEASE_SHA256=${digest}`,
    `CADENCR_RELEASE_VERSION=0.13.1;echo bad\nCADENCR_RELEASE_SHA256=${digest}`,
    `CADENCR_RELEASE_VERSION=0.13.1\nCADENCR_RELEASE_SHA256=${digest}\nEXTRA=yes`,
    "x".repeat(1025),
  ]) {
    const result = run(content);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /pins/);
    assert.equal(existsSync(path.join(root, "work")), false);
  }
  const acceptedShape = run(
    `CADENCR_RELEASE_VERSION=0.13.1-dev.39108033875.1\nCADENCR_RELEASE_SHA256=${digest}`,
  );
  assert.match(acceptedShape.stderr, /digest mismatch/);
  assert.equal(existsSync(path.join(root, "work")), false);
});

test("three-kind qualification invokes released semantic boundaries without executing fixtures", () => {
  const shell = readFileSync(script, "utf8");
  for (const kind of ["provider", "theme", "tab"])
    assert.match(shell, new RegExp(`registry pack-${kind}`));
  assert.match(shell, /plugin validate "\$CLI_WORK_ROOT\/qualification-tab" --kind tab/);
  assert.match(shell, /pack-tab --directory .* --package /);
  assert.match(shell, /for field in id name version api_version unknown nested malformed-envelope/);
  assert.match(shell, /TAB_PACKAGING_FAILED/);
  assert.match(shell, /run validate-contributions registry validate/);
  assert.match(shell, /schema_version':2,'package':value/);
  assert.match(shell, /len\(e\['signed'\]\['packages'\]\)!=3/);
  assert.match(shell, /cmp "\$CLI_WORK_ROOT\/tab-1.tar.gz" "\$CLI_WORK_ROOT\/tab-2.tar.gz"/);
  assert.match(shell, /fixture must never execute/);
  assert.match(shell, /CLI_QUALIFICATION_PINS/);
});

test("synthetic runner stops at version mismatch and emits key-free failed evidence", (t) => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "cli-synthetic-runner-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binary = path.join(root, "cadencr");
  const bytes = Buffer.from("\x7fELFsynthetic non-executable fixture");
  writeFileSync(binary, bytes, { mode: 0o700 });
  const digest = createHash("sha256").update(bytes).digest("hex");
  const pin = path.join(root, "pins.env");
  writeFileSync(
    pin,
    `CADENCR_RELEASE_VERSION=0.13.1-dev.39108033875.1\nCADENCR_RELEASE_SHA256=${digest}\n`,
  );
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  // Synthetic timeout stands in for an unavailable Linux execution surface.
  // It never executes the ELF or fixtures and cannot establish CLI qualification.
  writeFileSync(path.join(bin, "timeout"), "#!/bin/sh\nprintf 'cadencr 0.13.0\\n'\n", {
    mode: 0o700,
  });
  const work = path.join(root, "work");
  const result = spawnSync("sh", [script], {
    encoding: "utf8",
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      CLI: binary,
      CLI_WORK_ROOT: work,
      CLI_QUALIFICATION_PINS: pin,
    },
  });
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(path.join(work, "provider")), false);
  const evidence = JSON.parse(readFileSync(path.join(work, "evidence/evidence.json"), "utf8"));
  assert.equal(evidence.status, "failed");
  assert.equal(evidence.version, "0.13.1-dev.39108033875.1");
  assert.equal(evidence.cli_sha256, digest);
  assert.equal(evidence.lifecycle_qualified, false);
  assert.equal(existsSync(path.join(work, "keys/private.pem")), false);
  assert.equal(existsSync(path.join(work, "keys/public.pem")), false);
});

test("fixture generator submits all three kinds as new contributions", (t) => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "cli-contribution-fixtures-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const shell = readFileSync(script, "utf8");
  const marker = "python3 - <<'PY'\nimport os,pathlib,json,datetime,shutil\n";
  const body = shell.split(marker)[1].split("\nPY\n")[0];
  const result = spawnSync("python3", ["-c", "import os,pathlib,json,datetime,shutil\n" + body], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      CLI_WORK_ROOT: root,
      SCRIPT_ROOT: path.dirname(script),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  for (const [name, kind] of [
    ["example-provider-0.1.0.json", "provider"],
    ["qualification-1.0.0.json", "theme"],
    ["qualification-tab-1.0.0.json", "tab"],
  ]) {
    assert.equal(existsSync(path.join(root, "base/packages", name)), false);
    const pkg = JSON.parse(readFileSync(path.join(root, "candidate/packages", name), "utf8"));
    const submission = JSON.parse(
      readFileSync(path.join(root, "candidate/submissions", name), "utf8"),
    );
    assert.equal(pkg.kind, kind);
    assert.equal(submission.schema_version, 2);
    assert.deepEqual(submission.package, pkg);
    const descriptor = pkg.package[kind === "provider" ? "agent" : kind];
    assert.equal(submission.source.repository, descriptor.repository);
    assert.equal(submission.source.tag, `v${descriptor.version}`);
  }
});
