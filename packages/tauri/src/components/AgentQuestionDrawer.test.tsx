import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { AgentQuestionDrawer, parseAskUserQuestions } from "./AgentQuestionDrawer";
import type { AgentQuestion } from "./AgentQuestionDrawer";

vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn(),
}));

const simpleQuestion: AgentQuestion = {
  question: "What is your name?",
};

const questionWithOptions: AgentQuestion = {
  question: "Choose a color",
  options: [{ label: "Red" }, { label: "Blue" }],
};

const multiSelectQuestion: AgentQuestion = {
  question: "Pick multiple",
  options: [{ label: "Option A" }, { label: "Option B" }, { label: "Option C" }],
  multiSelect: true,
};

describe("AgentQuestionDrawer", () => {
  const onSubmit = vi.fn();

  beforeEach(() => {
    onSubmit.mockClear();
  });

  it("does not render when closed", () => {
    const { container } = render(
      <AgentQuestionDrawer questions={[simpleQuestion]} onSubmit={onSubmit} open={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders question text when open", () => {
    render(<AgentQuestionDrawer questions={[simpleQuestion]} onSubmit={onSubmit} open />);
    expect(screen.getByText("What is your name?")).toBeInTheDocument();
  });

  it("renders option buttons for question with options", () => {
    render(<AgentQuestionDrawer questions={[questionWithOptions]} onSubmit={onSubmit} open />);
    const buttons = screen.getAllByRole("button");
    const redBtn = buttons.find((b) => b.textContent?.includes("Red"));
    const blueBtn = buttons.find((b) => b.textContent?.includes("Blue"));
    expect(redBtn).toBeTruthy();
    expect(blueBtn).toBeTruthy();
  });

  it("submits selected option on submit click", async () => {
    const user = userEvent.setup();
    render(<AgentQuestionDrawer questions={[questionWithOptions]} onSubmit={onSubmit} open />);
    const buttons = screen.getAllByRole("button");
    const redBtn = buttons.find((b) => b.textContent?.includes("Red"))!;
    await user.click(redBtn);
    const submitBtns = screen.getAllByRole("button");
    const submitBtn = submitBtns.find(
      (b) => b.textContent?.includes("Submit") || b.textContent?.includes("Next"),
    );
    expect(submitBtn).toBeTruthy();
    await user.click(submitBtn!);
    expect(onSubmit).toHaveBeenCalledWith([["Red"]]);
  });

  it("allows multiple selections in multiSelect mode", async () => {
    const user = userEvent.setup();
    render(<AgentQuestionDrawer questions={[multiSelectQuestion]} onSubmit={onSubmit} open />);
    const buttons = screen.getAllByRole("button");
    const optABtn = buttons.find((b) => b.textContent?.includes("Option A"))!;
    const optBBtn = buttons.find((b) => b.textContent?.includes("Option B"))!;
    await user.click(optABtn);
    await user.click(optBBtn);
    const submitBtn = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("Submit") || b.textContent?.includes("Next"))!;
    await user.click(submitBtn);
    expect(onSubmit).toHaveBeenCalledWith([["Option A", "Option B"]]);
  });

  it("shows Other option button", () => {
    render(<AgentQuestionDrawer questions={[questionWithOptions]} onSubmit={onSubmit} open />);
    const buttons = screen.getAllByRole("button");
    const otherBtn = buttons.find((b) => b.textContent?.includes("Other"));
    expect(otherBtn).toBeTruthy();
  });

  it("shows text input after clicking Other", async () => {
    const user = userEvent.setup();
    render(<AgentQuestionDrawer questions={[questionWithOptions]} onSubmit={onSubmit} open />);
    const buttons = screen.getAllByRole("button");
    const otherBtn = buttons.find((b) => b.textContent?.includes("Other"))!;
    await user.click(otherBtn);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("shows first question when multiple questions provided", () => {
    render(
      <AgentQuestionDrawer
        questions={[simpleQuestion, questionWithOptions]}
        onSubmit={onSubmit}
        open
      />,
    );
    expect(screen.getByText("What is your name?")).toBeInTheDocument();
  });

  it("shows preview when an option with preview is selected", async () => {
    const user = userEvent.setup();
    const questionWithPreview: AgentQuestion = {
      question: "Pick one",
      options: [{ label: "Alpha", preview: "┌───┐\n│ A │\n└───┘" }, { label: "Beta" }],
    };
    render(<AgentQuestionDrawer questions={[questionWithPreview]} onSubmit={onSubmit} open />);
    expect(screen.queryByText(/┌───┐/)).toBeNull();
    const alphaBtn = screen.getAllByRole("button").find((b) => b.textContent?.includes("Alpha"))!;
    await user.click(alphaBtn);
    expect(screen.getByText(/┌───┐/)).toBeInTheDocument();
  });
});

describe("parseAskUserQuestions", () => {
  it("parses multiSelect from tool input", () => {
    const result = parseAskUserQuestions({
      questions: [
        {
          question: "Pick languages",
          multiSelect: true,
          options: [{ label: "TypeScript" }, { label: "Rust" }],
        },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].multiSelect).toBe(true);
  });

  it("prefers questions array over duplicated single-question fields", () => {
    const result = parseAskUserQuestions({
      question: "What exact file path should you edit?",
      options: [{ label: "src/main.rs" }],
      questions: [
        {
          question: "What exact file path should you edit?",
          multiple: false,
          options: [{ label: "src/main.rs" }, { label: "Other file" }],
        },
        {
          question: "Which mode should you use?",
          multiple: false,
          options: [{ label: "minimal" }, { label: "moderate" }],
        },
      ],
    });

    expect(result).toHaveLength(2);
    expect(result[0].question).toBe("What exact file path should you edit?");
    expect(result[1].question).toBe("Which mode should you use?");
  });

  it("supports OpenCode multiple flag for multi-select questions", () => {
    const result = parseAskUserQuestions({
      questions: [
        {
          question: "Pick options",
          multiple: true,
          options: [{ label: "A" }, { label: "B" }],
        },
      ],
    });

    expect(result[0].multiSelect).toBe(true);
  });

  it("parses preview from options", () => {
    const result = parseAskUserQuestions({
      question: "Pick one",
      options: [{ label: "A", preview: "diagram" }],
    });
    expect(result[0].options?.[0].preview).toBe("diagram");
  });

  it("defaults multiSelect to false", () => {
    const result = parseAskUserQuestions({ question: "Hello?" });
    expect(result[0].multiSelect).toBe(false);
  });
});
