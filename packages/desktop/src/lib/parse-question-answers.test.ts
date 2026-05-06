import { describe, it, expect } from "vitest";
import { parseQuestionAnswers } from "./parse-question-answers";

describe("parseQuestionAnswers", () => {
  it("parses a single answer with question text in response", () => {
    const questions = [{ question: "What is your name?" }];
    const response = "What is your name?\nAnswer: Alice";
    expect(parseQuestionAnswers(questions, response)).toEqual({
      "What is your name?": "Alice",
    });
  });

  it("parses multiple answers separated by double newlines", () => {
    const questions = [{ question: "Q1?" }, { question: "Q2?" }];
    const response = "Q1?\nAnswer: First\n\nQ2?\nAnswer: Second";
    expect(parseQuestionAnswers(questions, response)).toEqual({
      "Q1?": "First",
      "Q2?": "Second",
    });
  });

  it("trims whitespace from answers", () => {
    const questions = [{ question: "Q?" }];
    const response = "Q?\nAnswer:   spaced   ";
    expect(parseQuestionAnswers(questions, response)).toEqual({
      "Q?": "spaced",
    });
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
    const response = "Q?\nNo answer here";
    expect(parseQuestionAnswers(questions, response)).toEqual({});
  });

  it("handles question text containing double newlines", () => {
    const questions = [
      {
        question: "This is a long question.\n\nIt has multiple paragraphs.\n\nSeverity: **Medium**",
      },
    ];
    const response =
      "This is a long question.\n\nIt has multiple paragraphs.\n\nSeverity: **Medium**\nAnswer: Accept this risk";
    expect(parseQuestionAnswers(questions, response)).toEqual({
      "This is a long question.\n\nIt has multiple paragraphs.\n\nSeverity: **Medium**":
        "Accept this risk",
    });
  });

  it("handles multiple questions where question text contains double newlines", () => {
    const questions = [
      { question: "Risk 1 description.\n\nSeverity: **High**\n\nHow to handle?" },
      { question: "Risk 2 description.\n\nSeverity: **Low**\n\nHow to handle?" },
    ];
    const response =
      "Risk 1 description.\n\nSeverity: **High**\n\nHow to handle?\nAnswer: Create mitigation\n\n" +
      "Risk 2 description.\n\nSeverity: **Low**\n\nHow to handle?\nAnswer: Accept risk";
    expect(parseQuestionAnswers(questions, response)).toEqual({
      "Risk 1 description.\n\nSeverity: **High**\n\nHow to handle?": "Create mitigation",
      "Risk 2 description.\n\nSeverity: **Low**\n\nHow to handle?": "Accept risk",
    });
  });

  it("handles more questions than present in response", () => {
    const questions = [{ question: "Q1?" }, { question: "Q2?" }];
    const response = "Q1?\nAnswer: Only one";
    const result = parseQuestionAnswers(questions, response);
    expect(result["Q1?"]).toBe("Only one");
    expect(result["Q2?"]).toBeUndefined();
  });
});
