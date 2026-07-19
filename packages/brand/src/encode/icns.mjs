// ICNS container with modern PNG-compressed entries, for the macOS app icon.
// A malformed ICNS only surfaces at electron-builder packaging time, so the
// reader below gives `--check` round-trip coverage of the writer.

export function icns(entries) {
  const chunks = entries.map(({ type, buf }) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, "ascii");
    header.writeUInt32BE(buf.length + header.length, 4);
    return Buffer.concat([header, buf]);
  });
  const totalLength = 8 + chunks.reduce((total, chunk) => total + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(totalLength, 4);
  return Buffer.concat([header, ...chunks]);
}

/**
 * Parse an ICNS back into `{ type, buf }` chunks. Throws on a malformed file.
 *
 * The declared length must match the file exactly and the chunks must tile it
 * exactly: clamping the declared length instead (or stopping early) would let a
 * truncated or padded icon pass `--check` and only fail at packaging time.
 */
export function readIcns(file) {
  if (file.length < 8 || file.toString("ascii", 0, 4) !== "icns") {
    throw new Error("not an ICNS file (bad magic)");
  }
  const total = file.readUInt32BE(4);
  if (total !== file.length) {
    throw new Error(`ICNS declares ${total} bytes but the file is ${file.length}`);
  }
  const chunks = [];
  let at = 8;
  while (at < total) {
    if (at + 8 > total) throw new Error(`ICNS chunk header at ${at} is truncated`);
    const type = file.toString("ascii", at, at + 4);
    const length = file.readUInt32BE(at + 4);
    if (length < 8 || at + length > total) {
      throw new Error(`ICNS chunk "${type}" has an invalid length (${length})`);
    }
    chunks.push({ type, buf: file.subarray(at + 8, at + length) });
    at += length;
  }
  if (chunks.length === 0) throw new Error("ICNS declares no chunks");
  return chunks;
}
