import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ASSET_KINDS, renderAsset } from "../src/assets.mjs";
import { TARGETS } from "../src/targets/index.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const KINDS = new Set(ASSET_KINDS);

const allAssets = TARGETS.flatMap((t) => t.assets.map((a) => ({ target: t, asset: a })));

test("every asset path is unique and stays inside the repo", () => {
  const seen = new Set();
  for (const { target, asset } of allAssets) {
    const rel = path.join(target.root, asset.path);
    assert.ok(!seen.has(rel), `${rel} is declared by more than one target`);
    seen.add(rel);
    const resolved = path.resolve(REPO_ROOT, rel);
    assert.ok(resolved.startsWith(REPO_ROOT + path.sep), `${rel} escapes the repo root`);
  }
});

test("every asset declares a renderable kind and a source", () => {
  for (const { target, asset } of allAssets) {
    const where = `${target.name}: ${asset.path}`;
    assert.ok(KINDS.has(asset.kind), `${where} has unknown kind "${asset.kind}"`);
    if (asset.kind === "ico" || asset.kind === "icns") {
      assert.ok(asset.entries?.length, `${where} has no entries`);
      for (const e of asset.entries) {
        assert.equal(typeof e.svg, "function", `${where} entry ${e.size} has no svg thunk`);
        assert.ok(e.size > 0, `${where} entry has a non-positive size`);
        // ICNS chunk ids are written as exactly 4 ASCII bytes, so a typo would
        // be NUL-padded into a silently wrong chunk type.
        if (asset.kind === "icns") {
          assert.match(e.type ?? "", /^[a-z0-9]{4}$/, `${where} entry has a bad icns type`);
        }
      }
    } else {
      assert.equal(typeof asset.svg, "function", `${where} has no svg thunk`);
    }
    // File extension and kind must agree, or a consumer gets the wrong bytes
    // under a name it trusts (electron-builder picks icons by extension).
    assert.ok(asset.path.endsWith(`.${asset.kind}`), `${where} does not end in .${asset.kind}`);
  }
});

test("every asset actually renders to a non-empty buffer", async () => {
  for (const { target, asset } of allAssets) {
    const buf = await renderAsset(asset);
    assert.ok(buf.length > 0, `${target.name}: ${asset.path} rendered empty`);
  }
});

// The webmanifests are hand-maintained, so a rename on either side breaks PWA
// install silently. Assert the icons they name are ones we actually generate.
const MANIFESTS = [
  { root: "packages/desktop", file: "public/manifest.webmanifest", publicDir: "public" },
  { root: "packages/landing", file: "public/site.webmanifest", publicDir: "public" },
];

for (const manifest of MANIFESTS) {
  test(`${manifest.root} webmanifest icons are all generated`, async () => {
    const raw = await readFile(path.join(REPO_ROOT, manifest.root, manifest.file), "utf8");
    const target = TARGETS.find((t) => t.root === manifest.root);
    const generated = new Set(target.assets.map((a) => a.path));
    for (const icon of JSON.parse(raw).icons) {
      const expected = path.posix.join(manifest.publicDir, icon.src.replace(/^\//, ""));
      assert.ok(
        generated.has(expected),
        `${manifest.file} references ${icon.src}, which no brand target generates`,
      );
    }
  });
}
