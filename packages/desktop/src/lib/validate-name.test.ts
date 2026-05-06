import { describe, expect, it } from "vitest";
import { validateSimpleName } from "./validate-name";

describe("validateSimpleName", () => {
  it("accepts plain names", () => {
    expect(validateSimpleName("foo.txt")).toBeNull();
    expect(validateSimpleName("my-folder")).toBeNull();
    expect(validateSimpleName("a")).toBeNull();
  });

  it("rejects empty / whitespace-only", () => {
    expect(validateSimpleName("")).toBe("Name cannot be empty");
    expect(validateSimpleName("   ")).toBe("Name cannot be empty");
  });

  it("rejects path separators", () => {
    expect(validateSimpleName("a/b")).toBe("Name cannot contain '/' or '\\'");
    expect(validateSimpleName("a\\b")).toBe("Name cannot contain '/' or '\\'");
  });

  it("rejects '.' and '..'", () => {
    expect(validateSimpleName(".")).toBe("Invalid name");
    expect(validateSimpleName("..")).toBe("Invalid name");
  });

  it("allows names containing dots elsewhere", () => {
    expect(validateSimpleName(".env")).toBeNull();
    expect(validateSimpleName("a..b")).toBeNull();
  });
});
