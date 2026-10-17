import { test } from "node:test";
import assert from "node:assert/strict";
import { realpathSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const sha = "a".repeat(40);
const zero = "0".repeat(64);
const hash = (data) => createHash("sha256").update(data).digest("hex");
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "author-gate-")));
  for (const dir of ["scripts", "plugins", "mock", "py"])
    mkdirSync(join(root, dir), { recursive: true });
  for (const file of [
    "official-plugin-author-gate.sh",
    "official-plugin-author-stage.sh",
    "official-plugin-author-policy.json",
    "official-plugin-author-cli.env",
  ])
    cpSync(resolve("scripts", file), join(root, "scripts", file));
  const policyPath = join(root, "scripts/official-plugin-author-policy.json");
  const releasePath = join(root, "plugins/release-policy.json");
  writeFileSync(releasePath, JSON.stringify({ schema_version: 1, publication: "PENDING" }));
  const env = {
    ...process.env,
    PATH: join(root, "mock") + ":" + process.env.PATH,
    PYTHONPATH: join(root, "py"),
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY: "merkr-software/CadencR",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: sha,
    GITHUB_WORKFLOW_REF:
      "merkr-software/CadencR/.github/workflows/official-plugin-author.yml@refs/heads/main",
  };
  function approve() {
    const pin = "CADENCR_RELEASE_VERSION=1.0.0\nCADENCR_RELEASE_SHA256=" + zero + "\n";
    writeFileSync(join(root, "scripts/official-plugin-author-cli.env"), pin);
    const evidence = JSON.stringify({
      schema_version: 1,
      author_release_contract: "QUALIFIED",
      cli_version: "1.0.0",
      cli_sha256: zero,
    });
    writeFileSync(join(root, "scripts/official-plugin-author-qualification.json"), evidence);
    writeFileSync(
      policyPath,
      JSON.stringify({
        schema_version: 1,
        publication: "APPROVED",
        repository: "merkr-software/CadencR",
        repository_id: 42,
        author_account: "author",
        environment_id: 123,
        admin_bypass_reviewed_disabled: true,
        author_cli_version: "1.0.0",
        author_cli_sha256: zero,
        author_cli_qualification_sha256: hash(evidence),
        author_cli_pin_sha256: hash(pin),
      }),
    );
    writeFileSync(releasePath, JSON.stringify({ schema_version: 1, publication: "APPROVED" }));
    writeFileSync(
      join(root, "mock/git"),
      `#!/bin/sh\ncase "$3" in\nls-tree) echo '100644 blob hash' ;;\nshow) cat '${releasePath}' ;;\nrev-parse) printf '%s\\n' '${sha}' ;;\n*) exit 1 ;;\nesac\n`,
      { mode: 0o700 },
    );
    writeFileSync(
      join(root, "py/sitecustomize.py"),
      `import io,json,os,urllib.request
class Opener:
 def open(self,request,**k):
  url=request.full_url if isinstance(request,urllib.request.Request) else request
  if 'deployment-branch-policies' in url: data={'total_count':1,'branch_policies':[{'name':'main','type':'branch'}]}
  elif 'environments/' in url: data={'id':123,'protection_rules':[{'type':'required_reviewers','prevent_self_review':True,'reviewers':[{'id':1}]}],'deployment_branch_policy':{'protected_branches':False,'custom_branch_policies':True}}
  else: data={'id':42,'full_name':'merkr-software/CadencR'}
  if os.environ.get('MOCK_ENV_ID') and 'environments/' in url: data['id']=124
  if os.environ.get('MOCK_ENV_BYPASS') and 'environments/' in url: data['can_admins_bypass']=True
  if os.environ.get('MOCK_ENV_UNPROTECTED') and 'environments/' in url: data={}
  if os.environ.get('MOCK_REPO_MISMATCH') and 'environments/' not in url: data={'id':43}
  return io.BytesIO(json.dumps(data).encode())
def build_opener(*a): return Opener()
urllib.request.build_opener=build_opener
`,
    );
    writeFileSync(
      join(root, "scripts/official-plugin-release.sh"),
      `#!/bin/sh\nmkdir "$5"\nprintf archive > "$5/theme.tar.gz"\nprintf '{"archive":"theme.tar.gz"}' > "$5/release.json"\n`,
      { mode: 0o700 },
    );
  }
  function run(script, args) {
    return spawnSync("sh", [join(root, "scripts", script), ...args], { env, encoding: "utf8" });
  }
  const stage = (digest = zero) =>
    run("official-plugin-author-stage.sh", [
      root,
      sha,
      "plugins/theme-graphite/v0.1.0",
      digest,
      join(root, "out-" + Math.random()),
    ]);
  return { root, env, approve, run, stage, policyPath };
}
test("network fixture preserves stdlib imports and mocks only HTTP access", () => {
  const f = fixture();
  f.approve();
  const result = spawnSync(
    "python3",
    [
      "-c",
      `import json,pathlib,sys,urllib.parse,urllib.request
assert pathlib.Path('fixture').name == 'fixture'
assert urllib.parse.urlparse('https://example.test/path').hostname == 'example.test'
assert urllib.parse.quote('theme / graphite', safe='') == 'theme%20%2F%20graphite'
assert not pathlib.Path(urllib.request.__file__).resolve().is_relative_to(pathlib.Path(sys.argv[1]))
request=urllib.request.Request('https://api.github.com/repos/merkr-software/CadencR')
with urllib.request.build_opener().open(request) as response:
 assert json.load(response) == {'id':42,'full_name':'merkr-software/CadencR'}
`,
      f.root,
    ],
    { env: f.env, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});
test("current author pin and policy fail before candidate access", () => {
  const f = fixture();
  const r = f.stage();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /AUTHOR_PUBLICATION_PENDING/);
  assert.equal(r.stdout, "");
});
test("gate rejects non-main and untrusted workflow contexts", () => {
  const f = fixture();
  f.approve();
  f.env.GITHUB_REF = "refs/tags/evil";
  assert.match(
    f.run("official-plugin-author-gate.sh", [sha, zero]).stderr,
    /AUTHOR_CONTEXT_INVALID/,
  );
  f.env.GITHUB_REF = "refs/heads/main";
  f.env.GITHUB_WORKFLOW_REF = "evil";
  assert.match(
    f.run("official-plugin-author-gate.sh", [sha, zero]).stderr,
    /AUTHOR_CONTEXT_INVALID/,
  );
});
test("mocked approved reconstruction is deterministic and confirmation rejects changed bytes", () => {
  const f = fixture();
  f.approve();
  const inspected = f.stage();
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.match(inspected.stdout, /^[0-9a-f]{64}\n$/);
  const confirmed = f.stage(inspected.stdout.trim());
  assert.equal(confirmed.status, 0, confirmed.stderr);
  assert.equal(confirmed.stdout, inspected.stdout);
  assert.match(f.stage("b".repeat(64)).stderr, /AUTHOR_REQUEST_DIGEST_MISMATCH/);
});
test("pin changes fail before preparation", () => {
  const f = fixture();
  f.approve();
  writeFileSync(join(f.root, "scripts/official-plugin-author-cli.env"), "changed");
  assert.match(f.stage().stderr, /AUTHOR_POLICY_INVALID/);
});
test("workflow has no artifact authority or write token and scopes author secret to final step", () => {
  const workflow = readFileSync(".github/workflows/official-plugin-author.yml", "utf8");
  assert.doesNotMatch(workflow, /download-artifact|contents: write|pull_request:/);
  assert.equal(workflow.match(/secrets\.CADENCR_AUTHOR_GITHUB_TOKEN/g)?.length, 1);
  assert.match(workflow, /environment: official-plugin-publication/);
  assert.match(workflow, /ref: \$\{\{ github.sha \}\}/);
});

test("tag mismatch and source policy drift fail before reconstruction", () => {
  const f = fixture();
  f.approve();
  writeFileSync(
    join(f.root, "mock/git"),
    `#!/bin/sh\ncase "$3" in\nls-tree) echo '100644 blob hash' ;;\nshow) cat '${join(f.root, "plugins/release-policy.json")}' ;;\nrev-parse) echo '${"b".repeat(40)}' ;;\nesac\n`,
    { mode: 0o700 },
  );
  assert.match(f.stage().stderr, /AUTHOR_TAG_INVALID/);
  writeFileSync(
    join(f.root, "mock/git"),
    `#!/bin/sh\ncase "$3" in\nls-tree) echo '100644 blob hash' ;;\nshow) echo '{}' ;;\nesac\n`,
    { mode: 0o700 },
  );
  assert.match(f.stage().stderr, /AUTHOR_POLICY_MISMATCH/);
});

test("unprotected environment and repository identity mismatch fail closed", () => {
  const f = fixture();
  f.approve();
  f.env.MOCK_ENV_UNPROTECTED = "1";
  assert.match(f.stage().stderr, /AUTHOR_ENVIRONMENT_ID_MISMATCH/);
  delete f.env.MOCK_ENV_UNPROTECTED;
  f.env.MOCK_REPO_MISMATCH = "1";
  assert.match(f.stage().stderr, /AUTHOR_REPOSITORY_INVALID/);
});

test("malformed dispatch input cannot reach source or environment inspection", () => {
  const f = fixture();
  f.approve();
  const result = f.run("official-plugin-author-gate.sh", ["bad\ninput", zero]);
  assert.match(result.stderr, /AUTHOR_INPUT_INVALID/);
  assert.equal(result.stdout, "");
});

test("qualification evidence must match the independently reviewed pin", () => {
  const f = fixture();
  f.approve();
  writeFileSync(join(f.root, "scripts/official-plugin-author-qualification.json"), "{}");
  assert.match(f.stage().stderr, /AUTHOR_QUALIFICATION_INVALID/);
});

test("environment identity binds reviewed no-bypass attestation", () => {
  const f = fixture();
  f.approve();
  // Documented normal response omits can_admins_bypass: explicit reviewed
  // attestation bound to the unchanged environment ID is required.
  assert.equal(f.stage().status, 0);
  f.env.MOCK_ENV_ID = "1";
  assert.match(f.stage().stderr, /AUTHOR_ENVIRONMENT_ID_MISMATCH/);
  delete f.env.MOCK_ENV_ID;
  f.env.MOCK_ENV_BYPASS = "1";
  assert.match(f.stage().stderr, /AUTHOR_ENVIRONMENT_UNPROTECTED/);
  delete f.env.MOCK_ENV_BYPASS;
  const policy = JSON.parse(readFileSync(f.policyPath, "utf8"));
  delete policy.admin_bypass_reviewed_disabled;
  writeFileSync(f.policyPath, JSON.stringify(policy));
  assert.match(f.stage().stderr, /AUTHOR_ENVIRONMENT_REVIEW_REQUIRED/);
});

test("real stage and preparation reconstruct independently and reject candidate payload drift", () => {
  const f = fixture();
  f.approve();
  cpSync(
    resolve("scripts/official-plugin-release.sh"),
    join(f.root, "scripts/official-plugin-release.sh"),
  );
  const releasePath = join(f.root, "plugins/release-policy.json");
  writeFileSync(
    releasePath,
    JSON.stringify({ schema_version: 1, publication: "APPROVED", themes: { graphite: "0.1.0" } }),
  );
  const payloadPath = join(f.root, "candidate-theme.json");
  writeFileSync(payloadPath, '{"label":"Graphite"}');
  writeFileSync(
    join(f.root, "mock/git"),
    `#!/usr/bin/env python3
import pathlib,sys
args=sys.argv[3:]
if args[0]=='remote': print('https://github.com/merkr-software/CadencR.git')
elif args[0]=='rev-parse': print('${sha}')
elif args[0]=='ls-tree': print('100644 blob hash')
elif args[0]=='show':
 path=args[1].split(':',1)[1]
 if path=='plugins/release-policy.json': sys.stdout.buffer.write(pathlib.Path('${releasePath}').read_bytes())
 elif path=='plugins/themes/graphite/theme.json': sys.stdout.buffer.write(pathlib.Path('${payloadPath}').read_bytes())
 elif path=='plugins/themes/LICENSE': print('Apache-2.0')
 else: sys.exit(1)
else: sys.exit(1)
`,
    { mode: 0o700 },
  );
  const fetchDir = join(f.root, "tooling/marketplace-registry/scripts/ci");
  mkdirSync(fetchDir, { recursive: true });
  const cli = join(f.root, "canonical-cli");
  writeFileSync(
    cli,
    `#!/usr/bin/env python3
import hashlib,json,pathlib,sys
if sys.argv[1]=='plugin': sys.exit(0)
args=sys.argv
source=pathlib.Path(args[args.index('--directory')+1])/'theme.json'
output=pathlib.Path(args[args.index('--output')+1])
payload=source.read_bytes(); output.write_bytes(payload)
print(json.dumps({'kind':'theme','archive':str(output),'sha256':hashlib.sha256(payload).hexdigest(),'size':len(payload)}))
`,
    { mode: 0o700 },
  );
  writeFileSync(join(fetchDir, "fetch-released-cli.sh"), `#!/bin/sh\nprintf '%s\\n' '${cli}'\n`);
  const inspected = f.stage();
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.match(inspected.stdout, /^[0-9a-f]{64}\n$/);
  const confirmed = f.stage(inspected.stdout.trim());
  assert.equal(confirmed.status, 0, confirmed.stderr);
  assert.equal(confirmed.stdout, inspected.stdout);
  writeFileSync(payloadPath, '{"label":"Changed candidate"}');
  const changed = f.stage(inspected.stdout.trim());
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /AUTHOR_REQUEST_DIGEST_MISMATCH/);
  assert.equal(changed.stdout, "");
});

test("preparation mode flags are mutually exclusive", () => {
  for (const flags of [
    ["--qualification", "--author-approved"],
    ["--author-approved", "--qualification"],
  ]) {
    const result = spawnSync(
      "sh",
      [resolve("scripts/official-plugin-release.sh"), ...flags, "repo", sha, "tag", "out"],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /mutually exclusive/);
  }
});
