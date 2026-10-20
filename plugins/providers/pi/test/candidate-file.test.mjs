import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCandidateFile } from "../scripts/read-candidate-file.mjs";

test("candidate input reads exact bounded bytes and rejects symlinks/oversize", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "pi-candidate-read-"));
  const path = join(root, "input");
  await fs.writeFile(path, "safe");
  assert.equal((await readCandidateFile(path, 4)).toString(), "safe");
  await assert.rejects(readCandidateFile(path, 3), /byte limit/);
  const link = join(root, "link");
  await fs.symlink(path, link);
  await assert.rejects(readCandidateFile(link, 4), /regular file/);
});

test("candidate input rejects inode replacement between inspection and descriptor open", async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), "pi-candidate-race-"));
  const path = join(root, "input");
  await fs.writeFile(path, "safe");
  const open = fs.open;
  let handle;
  t.mock.method(fs, "open", async (...args) => {
    await fs.rename(path, join(root, "retained-original"));
    await fs.writeFile(path, "swapped");
    handle = await open(...args);
    return handle;
  });
  await assert.rejects(readCandidateFile(path, 8), /changed while opening/);
  assert.equal(handle.fd, -1, "Rejected descriptor must be closed");
  assert.equal(await fs.readFile(join(root, "retained-original"), "utf8"), "safe");
  // Retain all scratch: unexpected CLI-created database/state must never be deleted.
});

test("candidate input bounds growth after descriptor inspection and closes the handle", async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), "pi-candidate-growth-"));
  const path = join(root, "input");
  await fs.writeFile(path, "safe");
  const open = fs.open;
  let handle;
  let readBytes = 0;
  t.mock.method(fs, "open", async (...args) => {
    handle = await open(...args);
    const read = handle.read.bind(handle);
    t.mock.method(handle, "read", async (...readArgs) => {
      await fs.appendFile(path, "growth-beyond-limit");
      const result = await read(...readArgs);
      readBytes += result.bytesRead;
      return result;
    });
    return handle;
  });
  await assert.rejects(readCandidateFile(path, 8), /byte limit/);
  assert.ok(readBytes <= 9, "Read at most the limit plus one detection byte");
  assert.equal(handle.fd, -1);
});
