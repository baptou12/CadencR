// Recorded source facts are not legal attestations or publication authority.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { NOT_PREPARED_TARGETS, PI_VERSION, PREPARED_TARGETS } from "./targets.mjs";

// Honest per-target evidence vocabulary. Only the three `native-loopback-qualified-*`
// states may back a declared `distribution.binary` entry (see source-readiness tests).
export const QUALIFIED_EVIDENCE = Object.freeze([
  "native-loopback-qualified-local",
  "native-loopback-qualified-container",
  "native-loopback-qualified-hosted",
]);
export const TARGET_EVIDENCE = Object.freeze([
  ...QUALIFIED_EVIDENCE,
  "historical-native-protocol-and-local-descriptor",
  "pending-hosted-run",
  "not-qualified",
]);

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
    facts.runtime?.pi !== PI_VERSION ||
    facts.runtime?.kind !== "external-node-pi" ||
    facts.runtime?.bundled !== false ||
    !PREPARED_TARGETS.includes(target) ||
    !isDeepStrictEqual(Object.keys(facts.targets ?? {}).sort(), [...PREPARED_TARGETS].sort()) ||
    !isDeepStrictEqual(facts.not_prepared_targets, NOT_PREPARED_TARGETS) ||
    Object.values(facts.targets).some(
      (entry) =>
        entry.preparation !== "external-node-pi-candidate" ||
        !TARGET_EVIDENCE.includes(entry.evidence),
    ) ||
    facts.historical_protocol_evidence?.qualifies_current_candidate !== false
  ) {
    throw new Error("Source readiness drift; review source assets, runtimes and target evidence");
  }
  return { ...facts, manifest_sha256: digest(bytes) };
}
