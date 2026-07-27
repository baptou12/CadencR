import { describe, expect, it } from "vitest";
import { GitHost } from "@/api/generated";
import { forgeKindCapabilities } from "./forge-kind-capabilities";

describe("forgeKindCapabilities", () => {
  it.each([
    [GitHost.GitHub, true, false],
    [GitHost.GitLab, true, false],
    [GitHost.Bitbucket, false, true],
    [GitHost.Other, false, false],
  ])("derives controls from draft provider %s", (kind, cliAuthAvailable, usernameRequired) => {
    expect(forgeKindCapabilities(kind)).toEqual({
      cliAuthAvailable,
      usernameRequired,
    });
  });
});
