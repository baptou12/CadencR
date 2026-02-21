import { describe, it, expect } from "vitest";
import { parseQuestionAnswers } from "./parse-question-answers";

describe("parseQuestionAnswers", () => {
  it("parses a single answer", () => {
    const questions = [{ question: "What is your name?" }];
    const response = "Answer: Alice";
    expect(parseQuestionAnswers(questions, response)).toEqual({
      "What is your name?": "Alice",
    });
  });

  it("parses multiple answers separated by double newlines", () => {
    const questions = [
      { question: "Q1?" },
      { question: "Q2?" },
    ];
    const response = "Answer: First\n\nAnswer: Second";
    expect(parseQuestionAnswers(questions, response)).toEqual({
      "Q1?": "First",
      "Q2?": "Second",
    });
  });

  it("trims whitespace from answers", () => {
    const questions = [{ question: "Q?" }];
    const response = "Answer:   spaced   ";
    expect(parseQuestionAnswers(questions, response)).toEqual({
      "Q?": "spaced",
    });
  });

  it("handles multi-line answer with dotall flag", () => {
    const questions = [{ question: "Q?" }];
    const response = "Answer: line one\nline two";
    const result = parseQuestionAnswers(questions, response);
    expect(result["Q?"]).toBe("line one\nline two");
  });

  it("returns empty object for empty response", () => {
    const questions = [{ question: "Q?" }];
    expect(parseQuestionAnswers(questions, "")).toEqual({});
  });

  it("returns empty object for empty questions array", () => {
    expect(parseQuestionAnswers([], "Answer: foo")).toEqual({});
  });

  it("ignores sections without Answer: prefix", () => {
    const questions = [{ question: "Q?" }];
    const response = "No answer here";
    expect(parseQuestionAnswers(questions, response)).toEqual({});
  });

  it("handles more questions than sections gracefully", () => {
    const questions = [{ question: "Q1?" }, { question: "Q2?" }];
    const response = "Answer: Only one";
    const result = parseQuestionAnswers(questions, response);
    expect(result["Q1?"]).toBe("Only one");
    expect(result["Q2?"]).toBeUndefined();
  });
});
