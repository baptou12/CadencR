import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { AgentQuestionDrawer } from "./AgentQuestionDrawer";
import type { AgentQuestion } from "./AgentQuestionDrawer";

vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn(),
}));

const simpleQuestion: AgentQuestion = {
  question: "What is your name?",
};

const questionWithOptions: AgentQuestion = {
  question: "Choose a color",
  options: [
    { label: "Red" },
    { label: "Blue" },
  ],
};

const multiSelectQuestion: AgentQuestion = {
  question: "Pick multiple",
  options: [
    { label: "Option A" },
    { label: "Option B" },
    { label: "Option C" },
  ],
  allowMultiple: true,
};

describe("AgentQuestionDrawer", () => {
  const onSubmit = vi.fn();

  beforeEach(() => {
    onSubmit.mockClear();
  });

  it("does not render when closed", () => {
    const { container } = render(
      <AgentQuestionDrawer
        questions={[simpleQuestion]}
        onSubmit={onSubmit}
        open={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders question text when open", () => {
    render(
      <AgentQuestionDrawer
        questions={[simpleQuestion]}
        onSubmit={onSubmit}
        open
      />,
    );
    expect(screen.getByText("What is your name?")).toBeInTheDocument();
  });

  it("renders options as buttons", () => {
    render(
      <AgentQuestionDrawer
        questions={[questionWithOptions]}
        onSubmit={onSubmit}
        open
      />,
    );
    expect(screen.getByText("Red")).toBeInTheDocument();
    expect(screen.getByText("Blue")).toBeInTheDocument();
  });

  it("selects an option on click and submits", async () => {
    const user = userEvent.setup();
    render(
      <AgentQuestionDrawer
        questions={[questionWithOptions]}
        onSubmit={onSubmit}
        open
      />,
    );
    // Click the Red option button
    await user.click(screen.getByText("Red").closest("button")!);
    // Submit button should appear
    const submitBtn = screen.getByRole("button", { name: /submit/i });
    await user.click(submitBtn);
    expect(onSubmit).toHaveBeenCalledWith("Red");
  });

  it("allows multiple selections in multiSelect mode", async () => {
    const user = userEvent.setup();
    render(
      <AgentQuestionDrawer
        questions={[multiSelectQuestion]}
        onSubmit={onSubmit}
        open
      />,
    );
    await user.click(screen.getByText("Option A").closest("button")!);
    await user.click(screen.getByText("Option B").closest("button")!);
    const submitBtn = screen.getByRole("button", { name: /submit/i });
    await user.click(submitBtn);
    expect(onSubmit).toHaveBeenCalledWith("Option A, Option B");
  });

  it("shows Other option", () => {
    render(
      <AgentQuestionDrawer
        questions={[questionWithOptions]}
        onSubmit={onSubmit}
        open
      />,
    );
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("shows text input after clicking Other", async () => {
    const user = userEvent.setup();
    render(
      <AgentQuestionDrawer
        questions={[questionWithOptions]}
        onSubmit={onSubmit}
        open
      />,
    );
    await user.click(screen.getByText("Other").closest("button")!);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("renders multiple questions and shows first", () => {
    render(
      <AgentQuestionDrawer
        questions={[simpleQuestion, questionWithOptions]}
        onSubmit={onSubmit}
        open
      />,
    );
    expect(screen.getByText("What is your name?")).toBeInTheDocument();
  });
});
