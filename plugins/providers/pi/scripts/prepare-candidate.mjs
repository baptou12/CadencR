// Local, unqualified preparation only. Registry validation/archive logic stays in Rust.
import { createHash } from "node:crypto";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildRuntime } from "./build.mjs";
import { CandidateInputError, readCandidateFile } from "./read-candidate-file.mjs";
import { sourceReadiness } from "./source-readiness.mjs";
import { PI_VERSION, PREPARED_TARGETS } from "./targets.mjs";
import { isMain } from "./entrypoint.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = "plugins/providers/pi";
const version = "0.4.1";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
class CandidateError extends Error {}
let stage = "arguments";
const fail = (message) => {
  throw new CandidateError(message);
};

function safeFailure(error) {
  if (error instanceof CandidateError || error instanceof CandidateInputError) return error.message;
  if (error instanceof SyntaxError) return "Invalid JSON input or CLI receipt";
  if (error instanceof TypeError) return "Invalid input structure or URL";
  const code = [
    "ENOENT",
    "EEXIST",
    "EACCES",
    "EPERM",
    "ENOTDIR",
    "EISDIR",
    "ENOSPC",
    "ELOOP",
  ].includes(error?.code)
    ? error.code
    : "IO_FAILURE";
  return `Filesystem/preparation operation failed (${code}); inspect inputs and retained scratch privately`;
}

function command(program, args, options = {}) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
  // Never forward tool diagnostics: they may contain local paths or environment data.
  if (result.error || result.status !== 0) {
    const tool = program === "git" ? "Source Git operation" : "Canonical CLI archive packing";
    const outcome = result.error
      ? "could not start or capture process"
      : `exited ${result.status ?? "without status"}`;
    fail(`${tool} ${outcome}; inspect the selected tool and inputs privately`);
  }
  return result.stdout;
}

function parseArgs(args) {
  const names = [
    "source-commit",
    "candidate-target",
    "runtime",
    "package",
    "cli",
    "cli-sha256",
    "directory",
  ];
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]?.slice(2);
    if (!args[i]?.startsWith("--") || !names.includes(name) || parsed[name] || !args[i + 1]) {
      fail("Expected each explicit candidate preparation option exactly once");
    }
    parsed[name] = args[i + 1];
  }
  if (names.some((name) => !parsed[name])) fail("All candidate preparation options are required");
  if (!/^[a-f0-9]{40}$/.test(parsed["source-commit"])) fail("Expected full source commit");
  if (!/^[a-f0-9]{64}$/.test(parsed["cli-sha256"])) fail("Expected exact CLI checksum");
  if (!PREPARED_TARGETS.includes(parsed["candidate-target"])) {
    fail("Explicit macOS or Linux candidate target required; preparation does not qualify it");
  }
  if (parsed.runtime !== "external-node-pi")
    fail("Only the existing external Node/Pi candidate is prepared");
  return parsed;
}

async function inspectRegularAbsolute(path, limit = 128 * 1024 * 1024) {
  if (!isAbsolute(path) || resolve(path) !== path || (await realpath(path)) !== path) {
    fail("Paths must be absolute, normalized and contain no symlinks");
  }
  const info = await lstat(path);
  if (!info.isFile() || info.size > limit) fail("Expected bounded regular input file");
}

async function regularAbsolute(path, limit = 128 * 1024 * 1024) {
  await inspectRegularAbsolute(path, limit);
  return readCandidateFile(path, limit);
}

function keys(value, allowed) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    fail("Unexpected candidate metadata fields");
}

function candidateMetadata(bytes, target) {
  if (bytes.length > 64 * 1024) fail("Candidate metadata too large");
  const metadata = JSON.parse(bytes);
  if (bytes.toString("utf8") !== `${JSON.stringify(metadata, null, 2)}\n`) {
    fail("Candidate metadata must use exact two-space JSON with one trailing newline");
  }
  keys(metadata, ["agent", "host"]);
  const { agent, host } = metadata;
  keys(agent, ["id", "name", "version", "description", "repository", "license", "distribution"]);
  keys(host, ["publisher", "compatibility", "assets"]);
  keys(host.compatibility, ["min_app_version", "max_app_version"]);
  keys(host.assets, ["icon", "readme", "license"]);
  keys(agent.distribution, ["binary"]);
  keys(agent.distribution.binary, [target]);
  const binary = agent.distribution.binary[target];
  keys(binary, ["archive", "cmd", "sha256"]);
  if (
    agent.id !== "pi" ||
    agent.name !== "Pi" ||
    agent.version !== version ||
    agent.description !== "External Cadencr provider connector for Pi's native RPC mode" ||
    agent.repository !== "https://github.com/merkr-software/CadencR" ||
    agent.license !== "Apache-2.0" ||
    binary.cmd !== "bin/provider" ||
    binary.sha256 !== "0".repeat(64) ||
    host.assets.icon !== "icon.svg" ||
    host.assets.readme !== "README.md" ||
    host.assets.license !== "LICENSE"
  ) {
    fail("Expected Pi candidate identity, zero digest and closed payload assets");
  }
  const url = new URL(binary.archive);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith(`/pi-${version}-${target}.tar.gz`)
  )
    fail("Expected credential-free HTTPS candidate archive URL");
  return metadata;
}

async function verifySource(commit) {
  const repo = command("git", ["-C", root, "rev-parse", "--show-toplevel"]).trim();
  if (command("git", ["-C", repo, "rev-parse", "HEAD"]).trim() !== commit)
    fail("Source commit must equal HEAD");
  command("git", ["-C", repo, "diff", "--quiet", commit, "--", sourcePath]);
  if (
    command("git", [
      "-C",
      repo,
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      sourcePath,
    ]).trim()
  ) {
    fail("Untracked candidate source refused");
  }
  const entries = command("git", ["-C", repo, "ls-tree", "-r", commit, "--", sourcePath])
    .trim()
    .split("\n");
  for (const entry of entries) {
    const match = /^(100644|100755) blob [a-f0-9]{40}\t(.+)$/.exec(entry);
    if (!match) fail("Only tracked regular candidate source files are allowed");
    await inspectRegularAbsolute(join(repo, match[2]));
  }

  return repo;
}

function sourceBytes(repo, commit, relative) {
  return command("git", ["-C", repo, "show", `${commit}:${sourcePath}/${relative}`], {
    encoding: null,
  });
}

function committedPrerequisites(repo, commit) {
  const metadata = JSON.parse(sourceBytes(repo, commit, "package.json"));
  const readme = sourceBytes(repo, commit, "README.md").toString("utf8");
  const pins = [
    ...readme.matchAll(
      /^npm install -g --ignore-scripts @earendil-works\/pi-coding-agent@(\d+\.\d+\.\d+)$/gm,
    ),
  ];
  if (
    metadata.version !== version ||
    metadata.engines?.node !== ">=22.19.0 <23.0.0" ||
    pins.length !== 1 ||
    pins[0][1] !== PI_VERSION
  ) {
    fail("Committed Pi version/runtime prerequisite changed; review the candidate contract");
  }
  const node = metadata.engines.node;
  const pi = pins[0][1];
  if (
    !readme.includes(`Node.js \`${node}\``) ||
    !readme.includes(
      `https://github.com/badlogic/pi-mono/blob/v${pi}/packages/coding-agent/docs/rpc.md`,
    ) ||
    !readme.includes(
      `https://github.com/badlogic/pi-mono/blob/v${pi}/packages/coding-agent/package.json`,
    )
  ) {
    fail("Committed runtime prerequisites and pinned documentation disagree");
  }
  return { kind: "external-node-pi", node, pi, bundled: false };
}

async function preparePayload(output, repo, commit) {
  const staging = join(output, "private-staging");
  await mkdir(staging);
  const source = join(output, "private-source");
  await mkdir(source);
  const modules = command("git", [
    "-C",
    repo,
    "ls-tree",
    "--name-only",
    commit,
    `${sourcePath}/src/`,
  ])
    .trim()
    .split("\n");
  for (const path of modules) {
    const name = path.slice(`${sourcePath}/src/`.length);
    if (!/^[a-z][a-z0-9-]*\.mjs$/.test(name)) fail("Unexpected runtime source path");
    await writeFile(join(source, name), sourceBytes(repo, commit, `src/${name}`), { flag: "wx" });
  }
  const files = await buildRuntime({
    outputDirectory: join(staging, "bin"),
    sourceDirectory: source,
  });
  for (const name of ["README.md", "LICENSE", "icon.svg"]) {
    await writeFile(join(staging, name), sourceBytes(repo, commit, name), { flag: "wx" });
  }
  if (!files.includes("provider")) fail("Runtime entrypoint missing");
  return staging;
}

async function prepare(args) {
  const options = parseArgs(args);
  const commit = options["source-commit"];
  stage = "source validation";
  const repo = await verifySource(commit);
  const runtime = committedPrerequisites(repo, commit);
  let readiness;
  try {
    readiness = sourceReadiness(
      (path) => sourceBytes(repo, commit, path),
      options["candidate-target"],
    );
  } catch {
    fail("Committed readiness facts changed; review source license, artwork, runtime and targets");
  }
  stage = "CLI verification";
  const cliBytes = await regularAbsolute(options.cli);
  if (digest(cliBytes) !== options["cli-sha256"]) fail("CLI checksum mismatch");
  stage = "candidate metadata";
  const metadataBytes = await regularAbsolute(options.package, 64 * 1024);
  const metadata = candidateMetadata(metadataBytes, options["candidate-target"]);
  stage = "output preparation";
  const output = options.directory;
  if (
    !isAbsolute(output) ||
    resolve(output) !== output ||
    (await realpath(dirname(output))) !== dirname(output)
  ) {
    fail("Output requires an existing symlink-free absolute parent");
  }
  // Exclusive directory creation preserves stale outputs and all retained scratch.
  await mkdir(output);
  stage = "source payload preparation";
  const staging = await preparePayload(output, repo, commit);
  const metadataPath = join(output, "private-package-input.json");
  await writeFile(metadataPath, metadataBytes, { flag: "wx" });
  const archiveName = `pi-${version}-${options["candidate-target"]}.tar.gz`;
  const pack = (name, packagePath = metadataPath) =>
    JSON.parse(
      command(options.cli, [
        "registry",
        "pack-provider",
        "--package",
        packagePath,
        "--target",
        options["candidate-target"],
        "--directory",
        staging,
        "--output",
        join(output, name),
      ]),
    );
  stage = "canonical archive packing";
  const first = pack(archiveName);
  metadata.agent.distribution.binary[options["candidate-target"]].sha256 = first.sha256;
  const finalMetadataPath = join(output, "package.json");
  await writeFile(finalMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx" });
  stage = "canonical reproducibility packing";
  const second = pack(`reproducibility-${archiveName}`, finalMetadataPath);
  const bytes = await regularAbsolute(join(output, archiveName));
  if (
    !bytes.equals(await regularAbsolute(join(output, `reproducibility-${archiveName}`))) ||
    first.sha256 !== digest(bytes) ||
    first.size !== bytes.length ||
    second.sha256 !== first.sha256
  ) {
    fail("Canonical archive reproducibility/receipt mismatch");
  }
  stage = "candidate receipt";
  const receipt = {
    schema_version: 1,
    authority: "candidate",
    publication: "PENDING",
    qualification: "PENDING",
    source: {
      repository: "merkr-software/CadencR",
      repository_authority: "unverified-local-checkout",
      commit: options["source-commit"],
      path: sourcePath,
    },
    version,
    candidate_target: options["candidate-target"],
    runtime,
    readiness,
    cli_sha256: digest(cliBytes),
    package_metadata_sha256: digest(await regularAbsolute(finalMetadataPath, 64 * 1024)),
    archive: { name: archiveName, sha256: first.sha256, size: first.size },
    gates: [
      "artwork-provenance",
      "license-review",
      "native-platform",
      "generic-host-conformance",
      "production-authority",
    ],
  };
  await writeFile(join(output, "candidate.json"), `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: "wx",
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (isMain(import.meta.url)) {
  try {
    await prepare(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `Pi candidate ${stage}: ${safeFailure(error)}; no publication authority granted\n`,
    );
    process.exitCode = 1;
  }
}
