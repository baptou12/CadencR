import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDevEnv } from "./env";

const keys = ["VITE_FRONTEND_PORT", "VITE_API_URL", "VITE_API_TOKEN"] as const;
const previous = new Map<string, string | undefined>();

afterEach(() => {
  for (const key of keys) {
    const value = previous.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  previous.clear();
});

function withEnvFile(contents: string): string {
  for (const key of keys) previous.set(key, process.env[key]);
  for (const key of keys) delete process.env[key];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cadencr-env-"));
  fs.writeFileSync(path.join(dir, ".env"), contents, "utf8");
  return dir;
}

describe("loadDevEnv", () => {
  it("parses quoted values containing hash and equals characters", () => {
    const root = withEnvFile(
      [
        "VITE_FRONTEND_PORT=1420",
        "VITE_API_URL=http://127.0.0.1:5005",
        'VITE_API_TOKEN="abc#def=ghi"',
      ].join("\n"),
    );

    loadDevEnv(root);

    expect(process.env.VITE_API_TOKEN).toBe("abc#def=ghi");
  });

  it("does not overwrite values already set in the process environment", () => {
    const root = withEnvFile(
      [
        "VITE_FRONTEND_PORT=1420",
        "VITE_API_URL=http://127.0.0.1:5005",
        "VITE_API_TOKEN=file-token",
      ].join("\n"),
    );
    process.env.VITE_API_TOKEN = "existing-token";

    loadDevEnv(root);

    expect(process.env.VITE_API_TOKEN).toBe("existing-token");
  });
});
