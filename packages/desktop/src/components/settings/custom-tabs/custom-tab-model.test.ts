import { describe, expect, it } from "vitest";
import { apiErrorCode } from "@/lib/api-errors";
import { customTabStatus, describeScope, enablementSummary } from "./custom-tab-model";
import { serviceError, tabFixture } from "./custom-tabs-fixtures";

const on = (global: boolean | null) =>
  tabFixture({ enablement: { global, project: null, effective: false, consent_required: false } });

describe("custom tab model", () => {
  it("ranks an invalid manifest above a missing build", () => {
    expect(customTabStatus(tabFixture())).toBe("valid");
    expect(customTabStatus(tabFixture({ entry_present: false }))).toBe("not-built");
    expect(customTabStatus(tabFixture({ status: "invalid", entry_present: false }))).toBe(
      "invalid",
    );
  });

  it("summarizes where a tab is switched on", () => {
    const ids = [1, 2, 3];
    expect(enablementSummary(on(null), new Map(), ids)).toBe("Off");
    expect(enablementSummary(on(true), new Map(), ids)).toBe("On everywhere");
    expect(enablementSummary(on(true), new Map([[2, false]]), ids)).toBe("On in 2 projects");
    expect(enablementSummary(on(false), new Map([[3, true]]), ids)).toBe("On in 1 project");
  });

  it("describes known scopes and flags unknown ones", () => {
    expect(describeScope("git:read").title).toBe("Git");
    expect(describeScope("teleport:write").description).toMatch(/does not know/);
  });

  it("reads service error codes", () => {
    expect(apiErrorCode(serviceError(409, "PLUGIN_TAB_CONSENT_STALE", "x"))).toBe(
      "PLUGIN_TAB_CONSENT_STALE",
    );
    expect(apiErrorCode(new Error("plain"))).toBeNull();
  });
});
