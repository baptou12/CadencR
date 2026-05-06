import { describe, it, expect } from "vitest";
import { cn, slugify, toRelativePath } from "./utils";

describe("cn", () => {
  it("merges basic class strings", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes (truthy)", () => {
    const condition = true as boolean;
    expect(cn("foo", condition && "bar")).toBe("foo bar");
  });

  it("handles conditional classes (falsy)", () => {
    const condition = false as boolean;
    expect(cn("foo", condition && "bar")).toBe("foo");
  });

  it("handles undefined and null values", () => {
    expect(cn("foo", undefined, null, "bar")).toBe("foo bar");
  });

  it("merges conflicting tailwind classes (last wins)", () => {
    expect(cn("p-4", "p-8")).toBe("p-8");
  });

  it("merges conflicting text color classes", () => {
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("handles array of classes", () => {
    expect(cn(["foo", "bar"])).toBe("foo bar");
  });

  it("handles empty input", () => {
    expect(cn()).toBe("");
  });

  it("handles object syntax", () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe("foo baz");
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Code Review")).toBe("code-review");
  });

  it("strips leading/trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  it("collapses non-alphanumeric runs into single hyphen", () => {
    expect(slugify("foo & bar!")).toBe("foo-bar");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });
});

describe("toRelativePath", () => {
  it("strips base path prefix", () => {
    expect(toRelativePath("/home/user/project/src/foo.ts", "/home/user/project")).toBe(
      "src/foo.ts",
    );
  });

  it("strips base path with trailing slash", () => {
    expect(toRelativePath("/home/user/project/src/foo.ts", "/home/user/project/")).toBe(
      "src/foo.ts",
    );
  });

  it("returns full path when basePath is undefined", () => {
    expect(toRelativePath("/home/user/project/src/foo.ts")).toBe("/home/user/project/src/foo.ts");
  });

  it("returns full path when it does not start with basePath", () => {
    expect(toRelativePath("/other/path/foo.ts", "/home/user/project")).toBe("/other/path/foo.ts");
  });
});
