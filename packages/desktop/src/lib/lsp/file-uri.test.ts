import { describe, it, expect } from "vitest";
import { pathToFileUri, fileUriToPath } from "./file-uri";

describe("file-uri", () => {
  it("round-trips simple absolute paths", () => {
    const p = "/Users/alice/code/src/main.ts";
    expect(fileUriToPath(pathToFileUri(p))).toBe(p);
  });

  it("encodes spaces and other reserved characters", () => {
    const p = "/Users/alice/My Project/src/index.ts";
    const uri = pathToFileUri(p);
    expect(uri).toBe("file:///Users/alice/My%20Project/src/index.ts");
    expect(fileUriToPath(uri)).toBe(p);
  });

  it("returns null for non-file URIs", () => {
    expect(fileUriToPath("http://example.com/x.ts")).toBeNull();
    expect(fileUriToPath("untitled:foo")).toBeNull();
  });
});
