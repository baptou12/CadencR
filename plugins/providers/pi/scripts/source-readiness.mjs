// Recorded source facts are not legal attestations or publication authority.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function sourceReadiness(read, target) {
  const bytes = read("readiness.json");
  const facts = JSON.parse(bytes);
  const metadata = JSON.parse(read("package.json"));
  if (
    facts.schema_version !== 1 ||
    !isDeepStrictEqual(facts.plugin, { kind: "provider", id: "pi", version: metadata.version }) ||
    facts.source_license?.declared_spdx !== metadata.license ||
    metadata.license !== "Apache-2.0" ||
    facts.source_license?.file !== "LICENSE" ||
    facts.source_license?.sha256 !== digest(read("LICENSE")) ||
    facts.artwork?.file !== "icon.svg" ||
    facts.artwork?.sha256 !== digest(read("icon.svg")) ||
    facts.runtime?.node !== metadata.engines?.node ||
    facts.runtime?.pi !== "0.85.1" ||
    facts.runtime?.kind !== "external-node-pi" ||
    facts.runtime?.bundled !== false ||
    !["darwin-aarch64", "darwin-x86_64"].includes(target) ||
    facts.targets?.[target]?.preparation !== "external-node-pi-candidate" ||
    facts.historical_protocol_evidence?.qualifies_current_candidate !== false
  ) {
    throw new Error("Source readiness drift; review source assets, runtimes and target evidence");
  }
  return { ...facts, manifest_sha256: digest(bytes) };
}
