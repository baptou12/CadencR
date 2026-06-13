import path from "node:path";
import { describe, expect, it } from "vitest";
import { devUserDataPath } from "./dev-user-data";

describe("devUserDataPath", () => {
  it("uses the default dev profile when no QA suffix is provided", () => {
    expect(devUserDataPath("/Users/example/AppData", undefined)).toBe(
      path.join("/Users/example/AppData", "@cadencr", "desktop-dev"),
    );
  });

  it("sanitizes an optional suffix so parallel QA instances get separate locks", () => {
    expect(devUserDataPath("/Users/example/AppData", "browser qa!")).toBe(
      path.join("/Users/example/AppData", "@cadencr", "desktop-dev-browser-qa"),
    );
  });
});
