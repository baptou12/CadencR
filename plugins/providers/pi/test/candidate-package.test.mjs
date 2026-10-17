import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const original = new URL("../", import.meta.url).pathname;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const cli = process.env.CADENCR_PI_CANDIDATE_TEST_CLI;

async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "pi-candidate-")));
  const repo = join(base, "repo");
  const plugin = join(repo, "plugins/providers/pi");
  await mkdir(plugin, { recursive: true });
  for (const file of ["src", "scripts", "package.json", "README.md", "LICENSE", "icon.svg"]) {
    await cp(join(original, file), join(plugin, file), { recursive: true });
  }
  const env = {
    ...process.env,
    HOME: base,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };
  const git = (...args) => {
    const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "--quiet");
  git("add", ".");
  git("commit", "--quiet", "-m", "Synthetic candidate fixture");
  const commit = git("rev-parse", "HEAD");
  const metadata = {
    agent: {
      id: "pi",
      name: "Pi",
      version: "0.4.0",
      description: "External Cadencr provider connector for Pi's native RPC mode",
      repository: "https://github.com/merkr-software/CadencR",
      license: "Apache-2.0",
      distribution: {
        binary: {
          "darwin-aarch64": {
            archive: "https://example.invalid/pi-0.4.0-darwin-aarch64.tar.gz",
            cmd: "bin/provider",
            sha256: "0".repeat(64),
          },
        },
      },
    },
    host: {
      publisher: "fixture",
      compatibility: { min_app_version: "0.13.1" },
      assets: { icon: "icon.svg", readme: "README.md", license: "LICENSE" },
    },
  };
  const packagePath = join(base, "input.json");
  await writeFile(packagePath, `${JSON.stringify(metadata, null, 2)}\n`);
  const cliPath = cli ? await realpath(resolve(cli)) : join(base, "unavailable-cli");
  if (!cli) await writeFile(cliPath, "unused");
  const output = join(base, "candidate");
  const args = [
    "--source-commit",
    commit,
    "--candidate-target",
    "darwin-aarch64",
    "--runtime",
    "external-node-pi",
    "--package",
    packagePath,
    "--cli",
    cliPath,
    "--cli-sha256",
    digest(await readFile(cliPath)),
    "--directory",
    output,
  ];
  const run = (overrides = {}) => {
    const updated = args.map((arg, index) =>
      index % 2 ? (overrides[args[index - 1]] ?? arg) : arg,
    );
    return spawnSync(
      process.execPath,
      [join(plugin, "scripts/prepare-candidate.mjs"), ...updated],
      { encoding: "utf8", env },
    );
  };
  return { base, plugin, output, args, run, git, metadata, packagePath };
}

test("candidate refuses implicit targets/runtime, wrong source and checksum before creating output", async () => {
  const f = await fixture();
  for (const overrides of [
    { "--candidate-target": "linux-x86_64" },
    { "--candidate-target": "auto" },
    { "--runtime": "native" },
    { "--source-commit": "0".repeat(40) },
    { "--cli-sha256": "0".repeat(64) },
  ]) {
    const result = f.run(overrides);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.ok(!result.stderr.includes(f.base));
  }
  await assert.rejects(readFile(join(f.output, "candidate.json")), /ENOENT/);
  assert.match(
    f.run({ "--cli-sha256": "0".repeat(64) }).stderr,
    /CLI verification: CLI checksum mismatch/,
  );
  await writeFile(f.packagePath, "{broken secret=not-public");
  const invalid = f.run();
  assert.match(invalid.stderr, /candidate metadata: Invalid JSON/);
  assert.ok(!invalid.stderr.includes("not-public"));
});

test("candidate refuses dirty, untracked and symlink source without packing", async () => {
  for (const attack of ["dirty", "untracked", "symlink", "pi-pin", "node-pin"]) {
    const f = await fixture();
    if (attack === "dirty") await writeFile(join(f.plugin, "LICENSE"), "changed");
    if (attack === "untracked") await writeFile(join(f.plugin, "src/untracked.mjs"), "secret");
    if (attack === "symlink") {
      await symlink(join(f.plugin, "LICENSE"), join(f.plugin, "src/link.mjs"));
      f.git("add", ".");
      f.git("commit", "--quiet", "-m", "Synthetic unsafe tree");
      f.args[1] = f.git("rev-parse", "HEAD");
    }
    if (attack.endsWith("-pin")) {
      const path = join(f.plugin, attack === "pi-pin" ? "README.md" : "package.json");
      const source = await readFile(path, "utf8");
      await writeFile(
        path,
        source.replace(
          attack === "pi-pin" ? "@0.85.1" : ">=22.19.0 <23.0.0",
          attack === "pi-pin" ? "@0.85.2" : ">=23.0.0",
        ),
      );
      f.git("add", ".");
      f.git("commit", "--quiet", "-m", "Synthetic prerequisite drift");
      f.args[1] = f.git("rev-parse", "HEAD");
    }
    const result = f.run();
    assert.equal(result.status, 1);
    if (attack.endsWith("-pin"))
      assert.match(result.stderr, /Committed Pi version\/runtime prerequisite changed/);
    await assert.rejects(readFile(join(f.output, "candidate.json")), /ENOENT/);
  }
});

test("candidate rejects metadata secrets, extra targets and symlink input paths", async () => {
  const f = await fixture();
  const binary = f.metadata.agent.distribution.binary["darwin-aarch64"];
  binary.env = { TOKEN: "never-archive-me" };
  await writeFile(f.packagePath, `${JSON.stringify(f.metadata, null, 2)}\n`);
  assert.equal(f.run().status, 1);
  delete binary.env;
  binary.archive += "?token=never-archive-me";
  await writeFile(f.packagePath, `${JSON.stringify(f.metadata, null, 2)}\n`);
  assert.equal(f.run().status, 1);
  binary.archive = "https://example.invalid/pi-0.4.0-darwin-aarch64.tar.gz";
  f.metadata.agent.distribution.binary["darwin-x86_64"] = binary;
  await writeFile(f.packagePath, `${JSON.stringify(f.metadata, null, 2)}\n`);
  assert.equal(f.run().status, 1);
  const link = join(f.base, "metadata-link");
  await symlink(f.packagePath, link);
  assert.equal(f.run({ "--package": link }).status, 1);
  const g = await fixture();
  const badCli = join(g.base, "failing-cli");
  await writeFile(
    badCli,
    "#!/bin/sh\nprintf 'private /secret/path TOKEN=not-public' >&2\nexit 7\n",
  );
  await chmod(badCli, 0o755);
  const failed = g.run({ "--cli": badCli, "--cli-sha256": digest(await readFile(badCli)) });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /canonical archive packing: Canonical CLI archive packing exited 7/);
  assert.ok(!/not-public|secret\/path/.test(failed.stderr));
  assert.ok(!failed.stderr.includes(g.base));
  const oversized = await fixture();
  await writeFile(oversized.packagePath, Buffer.alloc(64 * 1024 + 1, 32));
  const tooLarge = oversized.run();
  assert.equal(tooLarge.status, 1);
  assert.match(tooLarge.stderr, /candidate metadata: Expected bounded regular input file/);
  await assert.rejects(readFile(join(oversized.output, "candidate.json")), /ENOENT/);
});

test(
  "real Rust CLI creates source-bound reproducible candidate; preserves existing outputs",
  { skip: !cli },
  async () => {
    for (const target of ["darwin-aarch64", "darwin-x86_64"]) {
      const f = await fixture();
      const binary = f.metadata.agent.distribution.binary["darwin-aarch64"];
      binary.archive = `https://example.invalid/pi-0.4.0-${target}.tar.gz`;
      f.metadata.agent.distribution.binary = { [target]: binary };
      f.args[f.args.indexOf("--candidate-target") + 1] = target;
      f.metadata.host.assets = { license: "LICENSE", readme: "README.md", icon: "icon.svg" };
      await writeFile(f.packagePath, `${JSON.stringify(f.metadata, null, 2)}\n`);
      const result = f.run();
      assert.equal(result.status, 0, result.stderr);
      const receipt = JSON.parse(result.stdout);
      assert.equal(receipt.publication, "PENDING");
      assert.equal(receipt.qualification, "PENDING");
      assert.equal(receipt.runtime.bundled, false);
      assert.equal(receipt.runtime.node, ">=22.19.0 <23.0.0");
      assert.equal(receipt.runtime.pi, "0.85.1");
      assert.equal(receipt.source.commit, f.args[1]);
      assert.equal(
        receipt.archive.sha256,
        digest(await readFile(join(f.output, receipt.archive.name))),
      );
      assert.ok(!result.stdout.includes(f.base));
      const metadata = JSON.parse(await readFile(join(f.output, "package.json"), "utf8"));
      assert.equal(
        metadata.agent.distribution.binary[receipt.candidate_target].sha256,
        receipt.archive.sha256,
      );
      assert.equal(
        receipt.package_metadata_sha256,
        digest(await readFile(join(f.output, "package.json"))),
      );
      const archive = await readFile(join(f.output, receipt.archive.name));
      assert.deepEqual(
        archive,
        await readFile(join(f.output, `reproducibility-${receipt.archive.name}`)),
      );
      const listing = spawnSync("tar", ["-tzf", join(f.output, receipt.archive.name)], {
        encoding: "utf8",
      });
      assert.equal(listing.status, 0, listing.stderr);
      assert.ok(listing.stdout.includes("bin/provider"));
      assert.ok(
        !/package\.json|candidate\.json|private-|\.env|test\/|scripts\//.test(listing.stdout),
      );
      const again = f.run();
      assert.equal(again.status, 1);
      assert.deepEqual(await readFile(join(f.output, receipt.archive.name)), archive);
      const second = join(f.base, "second");
      assert.equal(f.run({ "--directory": second }).status, 0);
      assert.deepEqual(await readFile(join(second, receipt.archive.name)), archive);
    }
  },
);

test("candidate input refuses ambiguous metadata and symlink output", async () => {
  const f = await fixture();
  const document = JSON.stringify(f.metadata).replace(
    '"version":"0.4.0"',
    '"version":"9.0.0","version":"0.4.0"',
  );
  await writeFile(f.packagePath, document);
  assert.equal(f.run().status, 1);
  await assert.rejects(readFile(join(f.output, "candidate.json")), /ENOENT/);
  await writeFile(f.packagePath, `${JSON.stringify(f.metadata, null, 2)}\n`);
  const linked = join(f.base, "linked-output");
  await symlink(f.output, linked);
  assert.equal(f.run({ "--directory": linked }).status, 1);
  const parentLink = join(f.base, "linked-parent");
  await symlink(f.base, parentLink);
  assert.equal(f.run({ "--directory": join(parentLink, "new-candidate") }).status, 1);
});
