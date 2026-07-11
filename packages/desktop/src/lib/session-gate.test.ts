import { describe, expect, it } from "vitest";
import { parseGeneratedSessionGate } from "./session-gate";

describe("parseGeneratedSessionGate", () => {
  it("parses a provenance-matched gate payload", () => {
    const gate = parseGeneratedSessionGate(
      '<cadencr-gate from-session="7" from-feature="8" from-project="9" kind="permission" request-id="req-1" autonomy="human_only">\n{"options":[{"label":"Allow once"}]}\n</cadencr-gate>',
      { originKind: "session_generated", sourceSessionId: 7, sourceFeatureId: 8 },
    );
    expect(gate).toMatchObject({ childSessionId: 7, requestId: "req-1", kind: "permission" });
  });

  it("rejects a mismatched source session", () => {
    expect(
      parseGeneratedSessionGate(
        '<cadencr-gate from-session="7" from-feature="8" kind="question" request-id="r" autonomy="parent_may_answer">{}</cadencr-gate>',
        { originKind: "session_generated", sourceSessionId: 6 },
      ),
    ).toBeNull();
  });

  it("rejects mismatched feature and project provenance", () => {
    const content =
      '<cadencr-gate from-session="7" from-feature="8" from-project="9" kind="question" request-id="r" autonomy="parent_may_answer">{}</cadencr-gate>';
    expect(
      parseGeneratedSessionGate(content, {
        originKind: "session_generated",
        sourceSessionId: 7,
        sourceFeatureId: 99,
        sourceProjectId: 9,
      }),
    ).toBeNull();
    expect(
      parseGeneratedSessionGate(content, {
        originKind: "session_generated",
        sourceSessionId: 7,
        sourceFeatureId: 8,
        sourceProjectId: 99,
      }),
    ).toBeNull();
  });
});
