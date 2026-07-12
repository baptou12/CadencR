import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStatusStore } from "@/stores/session-status-store";
import { SessionGateBlock } from "./SessionGateBlock";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

const baseGate = {
  childSessionId: 22,
  childFeatureId: 2,
  childFeatureTitle: "Investigate deployment",
  childProjectId: 1,
  requestId: "req-42",
};

describe("SessionGateBlock", () => {
  beforeEach(() => {
    useSessionStatusStore.setState({
      hasSnapshot: true,
      bySession: {
        22: {
          status: "question",
          kind: "permission",
          requestId: "req-42",
          featureId: 2,
          seq: 1,
        },
      },
    });
  });

  afterEach(() => useSessionStatusStore.setState({ bySession: {}, hasSnapshot: false }));

  it("renders a child question and its choices without raw JSON", () => {
    render(
      <SessionGateBlock
        gate={{
          ...baseGate,
          kind: "question",
          payload: {
            request_id: "req-42",
            tool_name: "AskUserQuestion",
            tool_input: {
              questions: [
                {
                  question: "Which environment should I deploy to?",
                  options: [
                    { label: "Staging", description: "Validate before production" },
                    { label: "Production", description: "Deploy to users now" },
                  ],
                },
              ],
            },
            options: [],
          },
        }}
      />,
    );

    expect(screen.getByText("Which environment should I deploy to?")).toBeInTheDocument();
    expect(screen.getByText("Staging")).toBeInTheDocument();
    expect(screen.getByText("Validate before production")).toBeInTheDocument();
    expect(screen.queryByText(/tool_input/)).toBeNull();
    expect(screen.queryByText(/AskUserQuestion/)).toBeNull();
    expect(screen.getByText("Parent can respond")).toBeInTheDocument();
  });

  it("renders normalized legacy AskUserQuestion payloads as questions", () => {
    render(
      <SessionGateBlock
        gate={{
          ...baseGate,
          kind: "question",
          payload: {
            request_id: "req-42",
            tool_name: "AskUserQuestion",
            tool_input: { question: "Which provider?", options: ["Claude", "OpenCode"] },
            options: [],
          },
        }}
      />,
    );

    expect(screen.getByText("Which provider?")).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.queryByText("No command preview provided")).toBeNull();
  });

  it("renders a permission description and command preview without raw JSON", () => {
    render(
      <SessionGateBlock
        gate={{
          ...baseGate,
          kind: "permission",
          payload: {
            request_id: "req-42",
            tool_name: "Bash",
            tool_input: { command: "pnpm test --filter desktop" },
            description: "Run the desktop test suite",
            pattern: "Bash(pnpm test:*)",
            options: [{ decision: "allow_once", label: "Allow once", description: "This run" }],
          },
        }}
      />,
    );

    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(screen.getByText("Run the desktop test suite")).toBeInTheDocument();
    expect(screen.getByText("pnpm test --filter desktop")).toBeInTheDocument();
    expect(screen.queryByText(/allow_once/)).toBeNull();
    expect(screen.queryByText(/tool_input/)).toBeNull();
  });

  it("marks a child gate resolved when that exact request is no longer pending", () => {
    render(
      <SessionGateBlock
        gate={{
          ...baseGate,
          kind: "permission",
          payload: { request_id: "req-42", tool_name: "Bash", tool_input: {} },
        }}
      />,
    );

    expect(screen.getByText("Parent can respond")).toBeInTheDocument();

    act(() => {
      useSessionStatusStore.setState({
        bySession: {
          22: { status: "agent", kind: null, requestId: null, featureId: 2, seq: 2 },
        },
      });
    });

    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.queryByText("Parent can respond")).toBeNull();
  });

  it("does not reactivate a historical gate when the child opens a newer request", () => {
    useSessionStatusStore.setState({
      bySession: {
        22: {
          status: "question",
          kind: "permission",
          requestId: "req-new",
          featureId: 2,
          seq: 2,
        },
      },
    });

    render(
      <SessionGateBlock
        gate={{
          ...baseGate,
          kind: "permission",
          payload: { request_id: "req-42", tool_name: "Bash", tool_input: {} },
        }}
      />,
    );

    expect(screen.getByText("Resolved")).toBeInTheDocument();
  });

  it("renders a historical gate as resolved when the status snapshot has no active child", () => {
    useSessionStatusStore.setState({ bySession: {}, hasSnapshot: true });

    render(
      <SessionGateBlock
        gate={{
          ...baseGate,
          kind: "question",
          payload: { request_id: "req-42", tool_name: "AskUserQuestion", tool_input: {} },
        }}
      />,
    );

    expect(screen.getByText("Resolved")).toBeInTheDocument();
  });
});
