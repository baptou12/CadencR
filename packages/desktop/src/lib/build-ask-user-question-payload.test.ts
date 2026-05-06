import { describe, expect, it } from "vitest";
import { buildAskUserQuestionUpdatedInput } from "./build-ask-user-question-payload";

describe("buildAskUserQuestionUpdatedInput", () => {
  it("maps answers to the canonical question-text keyed object", () => {
    const toolInput = {
      questions: [{ question: "Pick a color" }, { question: "Pick a shape" }],
    };
    const result = buildAskUserQuestionUpdatedInput(toolInput, [["Red"], ["Square"]]);
    expect(result).toEqual({
      questions: toolInput.questions,
      answers: {
        "Pick a color": "Red",
        "Pick a shape": "Square",
      },
    });
  });

  it("comma-separates multi-select answers", () => {
    const toolInput = { questions: [{ question: "Languages?" }] };
    const result = buildAskUserQuestionUpdatedInput(toolInput, [["TypeScript", "Rust", "Go"]]);
    expect(result.answers).toEqual({ "Languages?": "TypeScript, Rust, Go" });
  });

  it("supports the single-question shape", () => {
    const toolInput = { question: "Why?" };
    const result = buildAskUserQuestionUpdatedInput(toolInput, [["because"]]);
    expect(result.answers).toEqual({ "Why?": "because" });
  });

  it("falls back to a generated label when the question text is missing", () => {
    const toolInput = { questions: [{}] };
    const result = buildAskUserQuestionUpdatedInput(toolInput, [["whatever"]]);
    expect(result.answers).toEqual({ "Question 1": "whatever" });
  });

  it("preserves original tool-input fields", () => {
    const toolInput = {
      questions: [{ question: "Q?" }],
      foo: "bar",
      nested: { keep: true },
    };
    const result = buildAskUserQuestionUpdatedInput(toolInput, [["a"]]);
    expect(result).toMatchObject({ foo: "bar", nested: { keep: true } });
  });
});
