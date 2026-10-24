import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { sourceReadiness } from "../scripts/source-readiness.mjs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("source facts bind retained license/artwork and distinguish historical target evidence", () => {
  for (const target of ["darwin-aarch64", "darwin-x86_64"]) {
    const facts = sourceReadiness(read, target);
    assert.equal(facts.manifest_sha256, digest(read("readiness.json")));
    assert.equal(facts.source_license.sha256, digest(read("LICENSE")));
    assert.equal(facts.artwork.sha256, digest(read("icon.svg")));
    assert.equal(facts.runtime.bundled, false);
    assert.equal(facts.targets["darwin-x86_64"].evidence, "not-qualified");
    assert.equal(
      facts.targets["darwin-aarch64"].evidence,
      "historical-native-protocol-and-local-descriptor",
    );
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
  for (const target of ["linux-x86_64", "windows-aarch64", "auto"]) {
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
  assert.deepEqual(agent.distribution.binary, {
    "darwin-aarch64": { archive: "PENDING", cmd: "bin/provider", sha256: "0".repeat(64) },
  });
  assert.deepEqual(host, {
    publisher: "PENDING",
    compatibility: { min_app_version: "PENDING" },
    assets: { icon: "icon.svg", readme: "README.md", license: "LICENSE" },
  });
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
