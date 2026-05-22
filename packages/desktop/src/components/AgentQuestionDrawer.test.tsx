import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { AgentQuestionDrawer, parseAskUserQuestions } from "./AgentQuestionDrawer";
import type { AgentQuestion } from "./AgentQuestionDrawer";

vi.mock("@tanstack/react-hotkeys", () => ({
  useHotkeys: vi.fn(),
}));

const mockedUseHotkeys = vi.mocked(useHotkeys);

interface RegisteredHotkey {
  callback: (event: KeyboardEvent) => void;
  hotkey: string;
}

function registeredHotkeys(): RegisteredHotkey[] {
  return mockedUseHotkeys.mock.calls.flatMap(([definitions]) =>
    definitions.map((definition) => ({
      callback: definition.callback as (event: KeyboardEvent) => void,
      hotkey: String(definition.hotkey),
    })),
  );
}

function findRegisteredHotkey(hotkey: string): RegisteredHotkey {
  const match = registeredHotkeys().find((definition) => definition.hotkey === hotkey);
  if (!match) throw new Error(`Expected hotkey ${hotkey} to be registered`);
  return match;
}

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
    mockedUseHotkeys.mockClear();
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

  it("registers digit hotkeys (no Mod) and Mod+O for Other", () => {
    render(<AgentQuestionDrawer questions={[questionWithOptions]} onSubmit={onSubmit} open />);
    const hotkeyStrings = registeredHotkeys().map((definition) => definition.hotkey);
    // Digit hotkeys without modifier
    expect(hotkeyStrings).toEqual(
      expect.arrayContaining(["1", "2", "3", "4", "5", "6", "7", "8", "9"]),
    );
    // cmd+O for Other
    expect(hotkeyStrings).toContain("Mod+O");
    // No cmd+digit hotkeys remain (those are reserved for the sidebar)
    expect(hotkeyStrings.some((s) => /Mod\+\d/.test(s))).toBe(false);
  });

  it("does not select options from AZERTY physical digit keys unless they emit digits", () => {
    render(<AgentQuestionDrawer questions={[questionWithOptions]} onSubmit={onSubmit} open />);
    const preventDefault = vi.fn();

    act(() => {
      findRegisteredHotkey("1").callback({
        code: "Digit1",
        key: "&",
        preventDefault,
      } as unknown as KeyboardEvent);
    });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(screen.getByText("Red").closest("button")).not.toHaveClass("border-primary");

    act(() => {
      findRegisteredHotkey("Shift+1").callback({
        code: "Digit1",
        key: "1",
        preventDefault,
      } as unknown as KeyboardEvent);
    });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(screen.getByText("Red").closest("button")).toHaveClass("border-primary");
  });

  it("selects the second option from the digit character, not the AZERTY é key", () => {
    render(<AgentQuestionDrawer questions={[questionWithOptions]} onSubmit={onSubmit} open />);
    const preventDefault = vi.fn();

    act(() => {
      findRegisteredHotkey("Shift+2").callback({
        code: "Digit2",
        key: "é",
        preventDefault,
      } as unknown as KeyboardEvent);
    });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(screen.getByText("Blue").closest("button")).not.toHaveClass("border-primary");

    act(() => {
      findRegisteredHotkey("Shift+2").callback({
        code: "Digit2",
        key: "2",
        preventDefault,
      } as unknown as KeyboardEvent);
    });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(screen.getByText("Blue").closest("button")).toHaveClass("border-primary");
  });

  it("invoking Escape closes the question gate", () => {
    const onCancel = vi.fn();
    render(
      <AgentQuestionDrawer
        questions={[questionWithOptions]}
        onSubmit={onSubmit}
        onCancel={onCancel}
        open
      />,
    );
    const handler = findRegisteredHotkey("Escape").callback as unknown as (e: {
      preventDefault: () => void;
      stopPropagation: () => void;
    }) => void;
    handler({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders a dismiss button when onCancel is provided and calls it on click", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <AgentQuestionDrawer
        questions={[questionWithOptions]}
        onSubmit={onSubmit}
        onCancel={onCancel}
        open
      />,
    );
    const dismissButton = screen.getByRole("button", { name: /dismiss question/i });
    await user.click(dismissButton);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("does not render a dismiss button when onCancel is omitted", () => {
    render(<AgentQuestionDrawer questions={[questionWithOptions]} onSubmit={onSubmit} open />);
    expect(screen.queryByRole("button", { name: /dismiss question/i })).toBeNull();
  });

  it("blurs the option button after click so Enter can validate", async () => {
    const user = userEvent.setup();
    render(<AgentQuestionDrawer questions={[questionWithOptions]} onSubmit={onSubmit} open />);
    const redBtn = screen.getAllByRole("button").find((b) => b.textContent?.includes("Red"))!;
    await user.click(redBtn);
    // After clicking an option, the button must not retain focus — otherwise pressing
    // Enter would re-trigger its onClick (toggling) instead of validating the form.
    expect(document.activeElement).not.toBe(redBtn);
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
