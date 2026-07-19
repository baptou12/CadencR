// The readers exist so `--check` can catch a corrupted committed icon. Anything
// they accept is drift that ships silently, so each test below corrupts one
// field and asserts the reader rejects it.
import assert from "node:assert/strict";
import test from "node:test";
import { ico, readIco } from "../src/encode/ico.mjs";
import { icns, readIcns } from "../src/encode/icns.mjs";

const entryA = Buffer.from("first entry payload");
const entryB = Buffer.from("second entry payload");

const sampleIco = () =>
  ico([
    { size: 16, buf: entryA },
    { size: 256, buf: entryB },
  ]);

const sampleIcns = () =>
  icns([
    { type: "ic04", buf: entryA },
    { type: "ic11", buf: entryB },
  ]);

test("ico round-trips sizes and payloads, including 256", () => {
  const parsed = readIco(sampleIco());
  assert.deepEqual(
    parsed.map((e) => e.size),
    [16, 256],
  );
  assert.ok(parsed[0].buf.equals(entryA));
  assert.ok(parsed[1].buf.equals(entryB));
});

test("icns round-trips types and payloads", () => {
  const parsed = readIcns(sampleIcns());
  assert.deepEqual(
    parsed.map((c) => c.type),
    ["ic04", "ic11"],
  );
  assert.ok(parsed[0].buf.equals(entryA));
  assert.ok(parsed[1].buf.equals(entryB));
});

const ICO_CORRUPTIONS = [
  ["reserved word", (f) => f.writeUInt16LE(1, 0), /reserved word/],
  ["type field", (f) => f.writeUInt16LE(2, 2), /bad type field/],
  ["entry height", (f) => f.writeUInt8(24, 7), /not square/],
  ["color planes", (f) => f.writeUInt16LE(2, 10), /color planes/],
  ["bit depth", (f) => f.writeUInt16LE(24, 12), /bits per pixel/],
  ["entry offset", (f) => f.writeUInt32LE(999, 18), /expected/],
  ["entry length", (f) => f.writeUInt32LE(9999, 14), /past end of file/],
];

for (const [what, corrupt, expected] of ICO_CORRUPTIONS) {
  test(`readIco rejects a bad ${what}`, () => {
    const file = sampleIco();
    corrupt(file);
    assert.throws(() => readIco(file), expected);
  });
}

test("readIco rejects trailing garbage", () => {
  const file = Buffer.concat([sampleIco(), Buffer.from("junk")]);
  assert.throws(() => readIco(file), /trailing byte/);
});

test("readIco rejects a truncated file", () => {
  assert.throws(() => readIco(sampleIco().subarray(0, 20)), /truncated|past end of file/);
});

test("readIcns rejects a truncated file", () => {
  // The classic corruption: bytes lost, declared length untouched.
  assert.throws(() => readIcns(sampleIcns().subarray(0, 24)), /declares \d+ bytes/);
});

test("readIcns rejects appended garbage", () => {
  const file = Buffer.concat([sampleIcns(), Buffer.from("junk")]);
  assert.throws(() => readIcns(file), /declares \d+ bytes/);
});

test("readIcns rejects an inflated declared length", () => {
  const file = sampleIcns();
  file.writeUInt32BE(file.length + 64, 4);
  assert.throws(() => readIcns(file), /declares \d+ bytes/);
});

test("readIcns rejects a chunk length that overruns the file", () => {
  const file = sampleIcns();
  file.writeUInt32BE(9999, 12);
  assert.throws(() => readIcns(file), /invalid length/);
});

test("readIcns rejects bad magic", () => {
  const file = sampleIcns();
  file.write("junk", 0, 4, "ascii");
  assert.throws(() => readIcns(file), /bad magic/);
});
