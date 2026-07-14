import { describe, expect, it } from "vitest";
import {
  parseConversationReferenceHref,
  parseConversationReferences,
  serializeConversationReference,
} from "./conversation-reference";

describe("conversation reference serialization", () => {
  it("round-trips a stable feature reference", () => {
    const serialized = serializeConversationReference({
      featureId: 42,
      label: "Cadencr / Prompt references",
    });
    expect(serialized).toBe("[@@Cadencr / Prompt references](cadencr-conversation:feature/42)");
    expect(parseConversationReferences(serialized)).toEqual([
      {
        featureId: 42,
        label: "Cadencr / Prompt references",
        start: 0,
        end: serialized.length,
      },
    ]);
  });

  it("sanitizes labels that would break the marker", () => {
    expect(serializeConversationReference({ featureId: 7, label: "A [draft]\nconversation" })).toBe(
      "[@@A draft conversation](cadencr-conversation:feature/7)",
    );
  });

  it("finds multiple references embedded in prose", () => {
    const first = serializeConversationReference({ featureId: 1, label: "One" });
    const second = serializeConversationReference({ featureId: 2, label: "Two" });
    expect(
      parseConversationReferences(`Compare ${first} and ${second}`).map((item) => item.featureId),
    ).toEqual([1, 2]);
  });

  it("serializes the full reference label as a clickable markdown link", () => {
    expect(serializeConversationReference({ featureId: 42, label: "Cadencr / Work" })).toBe(
      "[@@Cadencr / Work](cadencr-conversation:feature/42)",
    );
    expect(parseConversationReferenceHref("cadencr-conversation:feature/42")).toBe(42);
    expect(parseConversationReferenceHref("https://example.com")).toBeNull();
  });

  it("rejects non-positive ids and removes markdown-breaking label characters", () => {
    expect(parseConversationReferences("[@@Invalid](cadencr-conversation:feature/0)")).toEqual([]);
    expect(serializeConversationReference({ featureId: 4, label: "Trailing\\" })).toBe(
      "[@@Trailing](cadencr-conversation:feature/4)",
    );
  });
});
