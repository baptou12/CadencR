import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { parse } from "yaml";

const workflow = parse(readFileSync(".github/workflows/desktop-release.yml", "utf8"));

test("manual release builds require an explicit existing version tag", () => {
  assert.equal(workflow.on.workflow_dispatch.inputs.release_tag.required, true);
  const steps = workflow.jobs["cli-linux"].steps;
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

test("both jobs build the tag rather than the workflow dispatch branch", () => {
  assert.equal(workflow.env.RELEASE_TAG, "${{ inputs.release_tag || github.ref_name }}");
  for (const name of ["cli-linux", "release"]) {
    const checkout = workflow.jobs[name].steps.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    assert.equal(checkout.with.ref, "refs/tags/${{ env.RELEASE_TAG }}");
  }
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
