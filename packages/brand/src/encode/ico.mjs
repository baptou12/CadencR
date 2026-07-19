// ICO container with PNG-compressed entries (supported by all modern parsers).
// The reader exists so `--check` can compare a committed .ico entry-by-entry
// as pixels instead of bytes, which also round-trip-tests the writer.

export function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const dirs = entries.map(({ size, buf }) => {
    const d = Buffer.alloc(16);
    d.writeUInt8(size >= 256 ? 0 : size, 0);
    d.writeUInt8(size >= 256 ? 0 : size, 1);
    d.writeUInt16LE(1, 4); // planes
    d.writeUInt16LE(32, 6); // bit depth
    d.writeUInt32LE(buf.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += buf.length;
    return d;
  });
  return Buffer.concat([header, ...dirs, ...entries.map((e) => e.buf)]);
}

/**
 * Parse an ICO back into `{ size, buf }` entries. Throws on a malformed file.
 *
 * This reader only ever sees output from `ico()` above, so it validates the
 * full structure rather than the fields it happens to need — anything it waves
 * through is drift that `--check` would silently pass.
 */
export function readIco(file) {
  if (file.length < 6) throw new Error("not an ICO file (too short for a header)");
  if (file.readUInt16LE(0) !== 0) throw new Error("not an ICO file (reserved word is not 0)");
  if (file.readUInt16LE(2) !== 1) throw new Error("not an ICO file (bad type field)");

  const count = file.readUInt16LE(4);
  if (count === 0) throw new Error("ICO declares no entries");

  const dirEnd = 6 + 16 * count;
  if (dirEnd > file.length) throw new Error("ICO directory is truncated");

  let expectedOffset = dirEnd;
  const entries = Array.from({ length: count }, (_, i) => {
    const d = 6 + 16 * i;
    // A 0 width/height byte means 256 — each field is a single byte.
    const size = file.readUInt8(d) || 256;
    const height = file.readUInt8(d + 1) || 256;
    const planes = file.readUInt16LE(d + 4);
    const bpp = file.readUInt16LE(d + 6);
    const length = file.readUInt32LE(d + 8);
    const offset = file.readUInt32LE(d + 12);

    if (height !== size) throw new Error(`ICO entry ${i} is not square (${size}x${height})`);
    if (planes !== 1) throw new Error(`ICO entry ${i} declares ${planes} color planes, expected 1`);
    if (bpp !== 32) throw new Error(`ICO entry ${i} declares ${bpp} bits per pixel, expected 32`);
    if (length === 0) throw new Error(`ICO entry ${i} is empty`);
    if (offset !== expectedOffset) {
      throw new Error(`ICO entry ${i} starts at ${offset}, expected ${expectedOffset}`);
    }
    if (offset + length > file.length) throw new Error(`ICO entry ${i} runs past end of file`);

    expectedOffset += length;
    return { size, buf: file.subarray(offset, offset + length) };
  });

  if (expectedOffset !== file.length) {
    throw new Error(
      `ICO has ${file.length - expectedOffset} trailing byte(s) after the last entry`,
    );
  }
  return entries;
}
