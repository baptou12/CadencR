import { describe, expect, it } from "vitest";

import { resolveAppEnvironmentKind } from "./app-environment";

describe("resolveAppEnvironmentKind", () => {
  it("shows dev for the vite dev server regardless of branch", () => {
    expect(resolveAppEnvironmentKind({ branch: "next", isDevServer: true })).toBe("dev");
    expect(resolveAppEnvironmentKind({ branch: "main", isDevServer: true })).toBe("dev");
  });

  it("shows next for a local build off the next branch", () => {
    expect(resolveAppEnvironmentKind({ branch: "next", isDevServer: false })).toBe("next");
    expect(resolveAppEnvironmentKind({ branch: "next\n", isDevServer: false })).toBe("next");
  });

  it("shows beta for a local build off main", () => {
    expect(resolveAppEnvironmentKind({ branch: "main", isDevServer: false })).toBe("beta");
  });

  it("shows beta when the branch is unknown, as in a detached release checkout", () => {
    expect(resolveAppEnvironmentKind({ branch: "HEAD", isDevServer: false })).toBe("beta");
    expect(resolveAppEnvironmentKind({ branch: "", isDevServer: false })).toBe("beta");
  });
});
