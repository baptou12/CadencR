// Standalone bounded input I/O; no dependency on registry/application tooling.
import { constants } from "node:fs";
import fs from "node:fs/promises";

export class CandidateInputError extends Error {}

export async function readCandidateFile(path, limit) {
  const before = await fs.lstat(path);
  if (!before.isFile()) throw new CandidateInputError("Candidate input must be a regular file");
  if (before.size > limit) throw new CandidateInputError("Candidate input exceeds its byte limit");
  const handle = await fs.open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new CandidateInputError("Candidate input changed while opening");
    }
    if (opened.size > limit)
      throw new CandidateInputError("Candidate input exceeds its byte limit");
    const chunks = [];
    let length = 0;
    while (length <= limit) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, limit + 1 - length));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      length += bytesRead;
    }
    if (length > limit) throw new CandidateInputError("Candidate input exceeds its byte limit");
    const after = await handle.stat();
    if (
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs
    ) {
      throw new CandidateInputError("Candidate input changed while reading");
    }
    return Buffer.concat(chunks, length);
  } finally {
    await handle.close();
  }
}
