import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { parse } from "yaml";

const workflow = parse(readFileSync(".github/workflows/desktop-release.yml", "utf8"));

test("manual release builds require an explicit existing version tag", () => {
  assert.equal(workflow.on.workflow_dispatch.inputs.release_tag.required, true);
  const steps = workflow.jobs.release.steps;
  const validationIndex = steps.findIndex((step) => step.name === "Validate release tag");
  const checkoutIndex = steps.findIndex((step) => step.uses?.startsWith("actions/checkout@"));
  assert.ok(validationIndex >= 0 && validationIndex < checkoutIndex);

  for (const [tag, valid] of [
    ["v0.14.0", true],
    ["v1.2.3", true],
    ["", false],
    ["main", false],
    ["refs/heads/v0.14.0", false],
    ["../v0.14.0", false],
    ["v0.14.0; echo unexpected", false],
    ["v0.14.0\necho unexpected", false],
  ]) {
    const result = spawnSync("bash", ["-c", steps[validationIndex].run], {
      env: { ...process.env, RELEASE_TAG: tag },
      encoding: "utf8",
    });
    assert.equal(result.status === 0, valid, `${JSON.stringify(tag)}: ${result.stderr}`);
  }
});

test("the release builds the tag rather than the workflow dispatch branch", () => {
  assert.equal(workflow.env.RELEASE_TAG, "${{ inputs.release_tag || github.ref_name }}");
  // The CLI ships through cli-release.yml; the app release is one job.
  assert.deepEqual(Object.keys(workflow.jobs), ["release"]);
  const checkout = workflow.jobs.release.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  assert.equal(checkout.with.ref, "refs/tags/${{ env.RELEASE_TAG }}");
  const create = workflow.jobs.release.steps.find(
    (step) => step.name === "Create draft GitHub release",
  );
  assert.match(create.run, /--verify-tag/);
});

test("release preparation refuses every existing release without deleting it", () => {
  const prepare = workflow.jobs.release.steps.find(
    (step) => step.name === "Prepare GitHub release",
  );
  const scratch = mkdtempSync(join(tmpdir(), "cadencr-release-target-"));
  try {
    writeFileSync(
      join(scratch, "gh"),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$GH_CALLS_FILE"\nprintf "%s" "$GH_RELEASES_OUTPUT"\n',
      { mode: 0o700 },
    );
    for (const existing of [
      "",
      "1\ttrue\t0\n",
      "1\tfalse\t0\n",
      "1\ttrue\t11\n",
      "1\tfalse\t11\n",
    ]) {
      const callsFile = join(scratch, "gh-calls.txt");
      writeFileSync(callsFile, "");
      const result = spawnSync("bash", ["-e", "-c", prepare.run], {
        env: {
          ...process.env,
          PATH: `${scratch}:${process.env.PATH}`,
          RUNNER_TEMP: scratch,
          GITHUB_REPOSITORY: "merkr-software/CadencR",
          RELEASE_TAG: "v0.14.0",
          GH_CALLS_FILE: callsFile,
          GH_RELEASES_OUTPUT: existing,
        },
        encoding: "utf8",
      });
      assert.equal(result.status === 0, existing === "", result.stderr);
      assert.equal(readFileSync(callsFile, "utf8").trim().split("\n").length, 1);
      assert.doesNotMatch(readFileSync(callsFile, "utf8"), /DELETE/);
    }
  } finally {
    rmSync(scratch, { recursive: true });
  }
});

test("packaging raises the descriptor limit inherited by pnpm", () => {
  const steps = workflow.jobs.release.steps;
  const packaging = steps.find((step) => step.name === "Build, sign, and notarize desktop app");
  const scratch = mkdtempSync(join(tmpdir(), "cadencr-packaging-limit-"));
  try {
    writeFileSync(join(scratch, "pnpm"), '#!/bin/bash\nprintf "fd-limit=%s\\n" "$(ulimit -Sn)"\n', {
      mode: 0o700,
    });
    const result = spawnSync("bash", ["-e", "-c", `ulimit -Sn 256\n${packaging.run}`], {
      env: { ...process.env, PATH: `${scratch}:${process.env.PATH}` },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const limit = result.stdout.match(/fd-limit=(\d+)/);
    assert.ok(limit, result.stdout);
    assert.ok(Number(limit[1]) >= 10240, result.stdout);
    const nativeIndex = steps.findIndex((step) => step.name?.startsWith("Build Rust service"));
    for (const name of ["Verify packaging dependency graph", "Build renderer + main bundles"]) {
      const index = steps.findIndex((step) => step.name === name);
      assert.ok(index >= 0 && index < nativeIndex, `${name} must fail before the native build`);
    }
  } finally {
    rmSync(scratch, { recursive: true });
  }
});

test("only listing uses the patched pnpm with its pinned integrity", () => {
  const setup = workflow.jobs.release.steps.find(
    (step) => step.name === "Use bounded pnpm listing for packaging",
  );
  const scratch = mkdtempSync(join(tmpdir(), "cadencr-packaging-pnpm-"));
  try {
    const upstream = join(scratch, "upstream");
    mkdirSync(upstream);
    const callsFile = join(scratch, "calls.txt");
    for (const command of ["pnpm", "corepack"]) {
      writeFileSync(
        join(upstream, command),
        '#!/bin/sh\nprintf "' + command + ':%s\\n" "$*" >> "$CALL_LOG"\n',
        { mode: 0o700 },
      );
    }
    const envFile = join(scratch, "github-env");
    const pathFile = join(scratch, "github-path");
    writeFileSync(envFile, "");
    writeFileSync(pathFile, "");
    const env = {
      ...process.env,
      PATH: upstream + ":" + process.env.PATH,
      RUNNER_TEMP: scratch,
      GITHUB_ENV: envFile,
      GITHUB_PATH: pathFile,
      CALL_LOG: callsFile,
    };
    delete env.BASH_ENV;
    const installed = spawnSync("bash", ["-e", "-c", setup.run], { env, encoding: "utf8" });
    assert.equal(installed.status, 0, installed.stderr);
    const exported = Object.fromEntries(
      readFileSync(envFile, "utf8")
        .trim()
        .split("\n")
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );
    const wrapper = join(readFileSync(pathFile, "utf8").trim(), "pnpm");
    writeFileSync(callsFile, "");
    for (const args of [
      ["list", "--prod", "--json"],
      ["--filter", "@cadencr/desktop", "exec", "electron-builder"],
    ]) {
      const result = spawnSync(wrapper, args, { env: { ...env, ...exported }, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
    const calls = readFileSync(callsFile, "utf8").trim().split("\n");
    assert.match(
      calls[0],
      /^corepack:pnpm@11\.13\.0\+sha512\.[a-f0-9]{128} --pm-on-fail=ignore list --prod --json$/,
    );
    assert.equal(calls[1], "pnpm:--filter @cadencr/desktop exec electron-builder");
    assert.equal(calls.length, 2);
  } finally {
    rmSync(scratch, { recursive: true });
  }
});
