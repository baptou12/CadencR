import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { ENVIRONMENT_EVIDENCE } from "../scripts/qualify-native.mjs";
import { QUALIFIED_EVIDENCE, sourceReadiness } from "../scripts/source-readiness.mjs";
import { PREPARED_TARGETS } from "../scripts/targets.mjs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("source facts bind retained license/artwork and keep per-target evidence honest", () => {
  for (const target of PREPARED_TARGETS) {
    const facts = sourceReadiness(read, target);
    assert.equal(facts.manifest_sha256, digest(read("readiness.json")));
    assert.equal(facts.source_license.sha256, digest(read("LICENSE")));
    assert.equal(facts.artwork.sha256, digest(read("icon.svg")));
    assert.equal(facts.runtime.bundled, false);
    assert.deepEqual(facts.not_prepared_targets, ["windows-aarch64", "windows-x86_64"]);
    assert.equal(facts.historical_protocol_evidence.qualifies_current_candidate, false);
  }
});

test("source facts reject changed license, artwork, identity, runtime and unsupported targets", () => {
  for (const name of ["LICENSE", "icon.svg"]) {
    assert.throws(
      () =>
        sourceReadiness(
          (file) => (file === name ? Buffer.from("changed") : read(file)),
          "darwin-aarch64",
        ),
      /Source readiness drift/,
    );
  }
  for (const mutate of [
    (facts) => {
      facts.plugin.version = "9.0.0";
    },
    (facts) => {
      facts.runtime.bundled = true;
    },
    (facts) => {
      facts.runtime.node = ">=23";
    },
    (facts) => {
      facts.runtime.pi = "0.85.2";
    },
    (facts) => {
      facts.targets["darwin-aarch64"].preparation = "supported";
    },
    (facts) => {
      facts.historical_protocol_evidence.qualifies_current_candidate = true;
    },
  ]) {
    const facts = JSON.parse(read("readiness.json"));
    mutate(facts);
    assert.throws(
      () =>
        sourceReadiness(
          (name) => (name === "readiness.json" ? Buffer.from(JSON.stringify(facts)) : read(name)),
          "darwin-aarch64",
        ),
      /Source readiness drift/,
    );
  }
  for (const mutate of [
    (facts) => {
      facts.targets["linux-x86_64"].evidence = "qualified";
    },
    (facts) => {
      delete facts.targets["linux-aarch64"];
    },
    (facts) => {
      facts.not_prepared_targets = [];
    },
  ]) {
    const facts = JSON.parse(read("readiness.json"));
    mutate(facts);
    assert.throws(
      () =>
        sourceReadiness(
          (name) => (name === "readiness.json" ? Buffer.from(JSON.stringify(facts)) : read(name)),
          "linux-aarch64",
        ),
      /Source readiness drift/,
    );
  }
  for (const target of ["windows-aarch64", "windows-x86_64", "auto"]) {
    assert.throws(() => sourceReadiness(read, target), /Source readiness drift/);
  }
});

test("source-owned package template fixes identity without inventing publication inputs", () => {
  const template = JSON.parse(read("package-template.json"));
  assert.equal(template.kind, "provider");
  const { agent, host } = template.package;
  const metadata = JSON.parse(read("package.json"));
  assert.deepEqual(
    {
      id: agent.id,
      name: agent.name,
      version: agent.version,
      license: agent.license,
      description: agent.description,
    },
    {
      id: "pi",
      name: "Pi",
      version: metadata.version,
      license: metadata.license,
      description: metadata.description,
    },
  );
  assert.equal(agent.repository, "https://github.com/merkr-software/CadencR");
  // Which targets are declared is pinned by the "declared exactly when qualified" test;
  // here every declared entry only has to stay a placeholder (no invented archive/digest).
  for (const entry of Object.values(agent.distribution.binary)) {
    assert.deepEqual(entry, { archive: "PENDING", cmd: "bin/provider", sha256: "0".repeat(64) });
  }
  assert.deepEqual(host, {
    publisher: "cadencr",
    compatibility: { min_app_version: "0.15.0" },
    assets: { icon: "icon.svg", readme: "README.md", license: "LICENSE" },
  });
});

test("only qualified targets are declared, and the release policy mirrors the declaration", () => {
  const declared = Object.keys(
    JSON.parse(read("package-template.json")).package.agent.distribution.binary,
  );
  const targets = JSON.parse(read("readiness.json")).targets;
  assert.ok(declared.length > 0);
  for (const target of PREPARED_TARGETS) {
    assert.equal(
      declared.includes(target),
      QUALIFIED_EVIDENCE.includes(targets[target].evidence),
      `${target} is declared exactly when its native loopback evidence is qualified`,
    );
  }
  const policy = JSON.parse(readFileSync(new URL("../../../release-policy.json", import.meta.url)));
  assert.deepEqual(Object.keys(policy.plugins["provider-pi"].payloads).sort(), declared.sort());
});

test("connector artwork has only the recorded local geometry, not external content", () => {
  const svg = read("icon.svg").toString("utf8");
  assert.deepEqual(
    [...svg.matchAll(/<([a-z][a-z0-9]*)(?:\s|>)/g)].map((match) => match[1]),
    ["svg", "rect", "path", "circle", "circle", "circle"],
  );
  assert.ok(svg.includes("SPDX-License-Identifier: Apache-2.0"));
  const artwork = JSON.parse(read("readiness.json")).artwork;
  assert.equal(artwork.declared_spdx, "Apache-2.0");
  assert.equal(artwork.creation_record, "README.md#connector-artwork");
  assert.ok(!svg.includes("165.29"));
  assert.ok(!/\bhref\s*=|\bon\w+\s*=|url\s*\(|<script|<style/i.test(svg));
});

// The executable payload as the packager would emit it: bin/* lines of its SHA256SUMS.
// Documentation edits (README) must not force requalification; source edits must.
async function executablePayloadSums() {
  const base = await mkdtemp(join(tmpdir(), "pi-readiness-payload-"));
  try {
    const packed = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../scripts/package.mjs", import.meta.url)),
        "--directory",
        join(base, "payload"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(packed.status, 0, packed.stderr);
    const sums = await readFile(join(base, "payload.SHA256SUMS"), "utf8");
    return sums
      .split("\n")
      .filter((line) => / {2}bin\//.test(line))
      .map((line) => `${line}\n`)
      .join("");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

test("recorded native qualification is bound to the current executable payload", async () => {
  const record = JSON.parse(read("readiness.json")).native_loopback_qualification;
  assert.equal(record.executable_payload_sha256sums_digest, digest(await executablePayloadSums()));
  assert.equal(record.uses_personal_credentials, false);
});

test("the recorded qualification agrees with the per-target evidence states", () => {
  const { targets, native_loopback_qualification: record } = JSON.parse(read("readiness.json"));
  const qualified = PREPARED_TARGETS.filter((t) =>
    QUALIFIED_EVIDENCE.includes(targets[t].evidence),
  );
  const pending = PREPARED_TARGETS.filter((t) => targets[t].evidence === "pending-hosted-run");
  assert.deepEqual(Object.keys(record.passed).sort(), qualified.sort());
  assert.deepEqual([...record.pending_hosted_run].sort(), pending.sort());
  for (const [target, passed] of Object.entries(record.passed)) {
    assert.equal(
      ENVIRONMENT_EVIDENCE[passed.environment],
      targets[target].evidence,
      `${target} evidence state follows the environment it ran in`,
    );
  }
  // A container pass must say how the CPU ran (a VM kernel of the target arch, never emulation).
  for (const passed of Object.values(record.passed).filter((p) => p.environment === "container")) {
    assert.match(passed.cpu_execution, /^native-.+-not-emulated$/);
  }
});
