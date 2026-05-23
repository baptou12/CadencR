import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import { act, fireEvent, render, screen } from "@/test-utils";
import type { EditorView } from "@codemirror/view";
import EditorSearchPanel from "../EditorSearchPanel";
import type { PaneSearchState } from "../search-cache";
import type { BufferSearchState } from "../search-extension";

const mocks = vi.hoisted(() => ({
  setBufferSearchQuery: vi.fn(),
  findNextMatch: vi.fn(),
  findPrevMatch: vi.fn(),
  closeBufferSearch: vi.fn(),
  selectActiveMatch: vi.fn(),
  subscribeBufferSearch: vi.fn(),
  getBufferSearchState: vi.fn(),
}));

vi.mock("../search-extension", async () => {
  return {
    MAX_BUFFER_MATCHES: 5000,
    setBufferSearchQuery: mocks.setBufferSearchQuery,
    findNextMatch: mocks.findNextMatch,
    findPrevMatch: mocks.findPrevMatch,
    closeBufferSearch: mocks.closeBufferSearch,
    selectActiveMatch: mocks.selectActiveMatch,
    subscribeBufferSearch: mocks.subscribeBufferSearch,
    getBufferSearchState: mocks.getBufferSearchState,
  };
});

function makeMockView(): EditorView {
  return {
    focus: vi.fn(),
  } as unknown as EditorView;
}

function emptyState(): BufferSearchState {
  return {
    query: { query: "", caseSensitive: false, regex: false },
    matches: [],
    activeIndex: -1,
    truncated: false,
    error: null,
  };
}

const defaultInitial: PaneSearchState = { query: "", caseSensitive: false, regex: false };

beforeEach(() => {
  mocks.setBufferSearchQuery.mockClear();
  mocks.findNextMatch.mockClear();
  mocks.findPrevMatch.mockClear();
  mocks.closeBufferSearch.mockClear();
  mocks.selectActiveMatch.mockClear();
  mocks.subscribeBufferSearch.mockClear();
  mocks.subscribeBufferSearch.mockImplementation(() => () => {});
  mocks.getBufferSearchState.mockReturnValue(emptyState());
});

function renderPanel(overrides?: {
  initialState?: PaneSearchState;
  reopenSignal?: number;
  onClose?: () => void;
  onChange?: (s: PaneSearchState) => void;
}) {
  const view = makeMockView();
  const onClose = overrides?.onClose ?? vi.fn();
  const onChange = overrides?.onChange ?? vi.fn();
  const utils = render(
    <EditorSearchPanel
      view={view}
      initialState={overrides?.initialState ?? defaultInitial}
      reopenSignal={overrides?.reopenSignal ?? 0}
      onChange={onChange}
      onClose={onClose}
    />,
  );
  return { view, onClose, onChange, ...utils };
}

function pushState(state: Partial<BufferSearchState>): void {
  const cb = (mocks.subscribeBufferSearch.mock.calls.at(-1)?.[1] ?? null) as
    | ((s: BufferSearchState) => void)
    | null;
  if (!cb) throw new Error("no subscriber registered");
  act(() => cb({ ...emptyState(), ...state }));
}

describe("EditorSearchPanel", () => {
  it("renders an empty input and no counter when query is empty", () => {
    renderPanel();
    const input = screen.getByPlaceholderText("Find") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(screen.queryByText(/of/)).not.toBeInTheDocument();
  });

  it("hydrates from initialState", () => {
    renderPanel({
      initialState: { query: "hello", caseSensitive: true, regex: false },
    });
    expect((screen.getByPlaceholderText("Find") as HTMLInputElement).value).toBe("hello");
    const caseToggle = screen.getByTitle("Match case");
    expect(caseToggle).toHaveAttribute("aria-pressed", "true");
  });

  it("shows 'No results' when the live state reports zero matches", () => {
    renderPanel({ initialState: { query: "xyz", caseSensitive: false, regex: false } });
    pushState({
      query: { query: "xyz", caseSensitive: false, regex: false },
      matches: [],
    });
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("renders the counter as 'N of M' when matches exist", () => {
    renderPanel({ initialState: { query: "foo", caseSensitive: false, regex: false } });
    pushState({
      query: { query: "foo", caseSensitive: false, regex: false },
      matches: [
        { from: 0, to: 3 },
        { from: 4, to: 7 },
      ],
      activeIndex: 1,
    });
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
  });

  it("renders the truncated suffix when MAX_BUFFER_MATCHES is hit", () => {
    renderPanel({ initialState: { query: "a", caseSensitive: false, regex: false } });
    pushState({
      query: { query: "a", caseSensitive: false, regex: false },
      matches: Array.from({ length: 5000 }, (_, i) => ({ from: i, to: i + 1 })),
      activeIndex: 0,
      truncated: true,
    });
    expect(screen.getByText("1 of 5000+")).toBeInTheDocument();
  });

  it("shows 'Bad regex' and marks the input invalid on regex error", () => {
    renderPanel({ initialState: { query: "[", caseSensitive: false, regex: true } });
    pushState({
      query: { query: "[", caseSensitive: false, regex: true },
      matches: [],
      error: "Invalid regex",
    });
    expect(screen.getByText("Bad regex")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Find")).toHaveAttribute("aria-invalid", "true");
  });

  it("calls findNextMatch on Enter", () => {
    renderPanel();
    fireEvent.keyDown(screen.getByPlaceholderText("Find"), { key: "Enter" });
    expect(mocks.findNextMatch).toHaveBeenCalledTimes(1);
  });

  it("calls findPrevMatch on Shift+Enter", () => {
    renderPanel();
    fireEvent.keyDown(screen.getByPlaceholderText("Find"), { key: "Enter", shiftKey: true });
    expect(mocks.findPrevMatch).toHaveBeenCalledTimes(1);
    expect(mocks.findNextMatch).not.toHaveBeenCalled();
  });

  it("on Cmd+Enter: selects the active match, blurs input, focuses buffer", () => {
    const { view } = renderPanel();
    fireEvent.keyDown(screen.getByPlaceholderText("Find"), { key: "Enter", metaKey: true });
    expect(mocks.selectActiveMatch).toHaveBeenCalledWith(view);
    expect(mocks.findNextMatch).not.toHaveBeenCalled();
    expect(view.focus as Mock).toHaveBeenCalled();
  });

  it("on Escape: closes the search and calls onClose", () => {
    const { view, onClose } = renderPanel();
    fireEvent.keyDown(screen.getByPlaceholderText("Find"), { key: "Escape" });
    expect(mocks.closeBufferSearch).toHaveBeenCalledWith(view);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(view.focus as Mock).toHaveBeenCalled();
  });

  it("clicking the next button calls findNextMatch when matches exist", () => {
    renderPanel();
    pushState({
      query: { query: "x", caseSensitive: false, regex: false },
      matches: [{ from: 0, to: 1 }],
      activeIndex: 0,
    });
    fireEvent.click(screen.getByTitle("Next match (Enter)"));
    expect(mocks.findNextMatch).toHaveBeenCalledTimes(1);
  });

  it("next / prev buttons are disabled when there are no matches", () => {
    renderPanel();
    expect(screen.getByTitle("Next match (Enter)")).toBeDisabled();
    expect(screen.getByTitle("Previous match (Shift+Enter)")).toBeDisabled();
  });

  it("toggling the case-sensitive button flips aria-pressed", () => {
    renderPanel({ initialState: { query: "foo", caseSensitive: false, regex: false } });
    const btn = screen.getByTitle("Match case");
    expect(btn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("toggling the regex button flips aria-pressed", () => {
    renderPanel({ initialState: { query: "foo", caseSensitive: false, regex: false } });
    const btn = screen.getByTitle("Use regular expression");
    expect(btn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("persists state to onChange whenever query, case, or regex change", () => {
    const onChange = vi.fn();
    renderPanel({ onChange });
    onChange.mockClear();
    fireEvent.change(screen.getByPlaceholderText("Find"), { target: { value: "abc" } });
    expect(onChange).toHaveBeenLastCalledWith({
      query: "abc",
      caseSensitive: false,
      regex: false,
    });
  });

  it("re-focuses and selects the input when reopenSignal increments", () => {
    const { rerender, view, onClose, onChange } = renderPanel({ reopenSignal: 0 });
    const input = screen.getByPlaceholderText("Find") as HTMLInputElement;
    input.blur();
    rerender(
      <EditorSearchPanel
        view={view}
        initialState={defaultInitial}
        reopenSignal={1}
        onChange={onChange}
        onClose={onClose}
      />,
    );
    expect(document.activeElement).toBe(input);
  });
});
