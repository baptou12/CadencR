// ICO container with PNG-compressed entries (supported by all modern parsers).
// Shared by the landing and desktop icon generators.
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
