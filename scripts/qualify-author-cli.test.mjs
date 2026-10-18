import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("distributed author CLI qualification guards and exact mocked network trace", () => {
  const result = spawnSync("python3", ["-B", "scripts/author-cli-qa/test_harness.py"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Ran 20 tests/);
});
