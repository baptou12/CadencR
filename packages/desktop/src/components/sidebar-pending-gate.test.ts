import { describe, expect, it } from "vitest";
import {
  buildOptions,
  effectiveGateKind,
  gatePrompt,
  triggerPendingKind,
} from "./sidebar-pending-gate";
import type { FeaturePendingGateResponse } from "@/api/generated";

function gate(
  partial: Partial<FeaturePendingGateResponse> &
    Pick<FeaturePendingGateResponse, "kind" | "payload">,
): FeaturePendingGateResponse {
  return {
    session_id: 1,
    request_id: "req-1",
    last_assistant_text: null,
    ...partial,
  };
}

describe("effectiveGateKind", () => {
  it("promotes AskUserQuestion permission payloads to question", () => {
    expect(
      effectiveGateKind(
        gate({
          kind: "permission",
          payload: {
            tool_name: "AskUserQuestion",
            tool_input: { question: "Ship it?", options: ["Yes", "No"] },
          },
        }),
      ),
    ).toBe("question");
  });
});

describe("gatePrompt", () => {
  it("shows the shell command for permission gates", () => {
    expect(
      gatePrompt(
        gate({
          kind: "permission",
          payload: {
            tool_name: "Bash",
            description: "The provider requests permission to use Bash",
            tool_input: { command: "git status" },
          },
        }),
      ),
    ).toBe("Bash: git status");
  });

  it("shows the question text for AskUserQuestion", () => {
    expect(
      gatePrompt(
        gate({
          kind: "permission",
          payload: {
            tool_name: "AskUserQuestion",
            description: "The provider requests permission to use AskUserQuestion",
            tool_input: { question: "Which target?", options: ["A", "B"] },
          },
        }),
      ),
    ).toBe("Which target?");
  });
});

describe("buildOptions", () => {
  it("builds question options even when the API kind is permission", () => {
    const options = buildOptions(
      gate({
        kind: "permission",
        payload: {
          tool_name: "AskUserQuestion",
          options: [{ decision: "allow_once", label: "Allow once", description: "" }],
          tool_input: {
            question: "Which target?",
            options: [{ label: "Staging" }, { label: "Prod" }],
          },
        },
      }),
    );
    expect(options.map((option) => option.label)).toEqual(["Staging", "Prod"]);
    expect(options[0]?.decision).toEqual({ type: "question", answers: [["Staging"]] });
  });
});

describe("triggerPendingKind", () => {
  it("prefers loaded gate classification over live status", () => {
    expect(triggerPendingKind("permission", "question")).toBe("question");
  });
});
