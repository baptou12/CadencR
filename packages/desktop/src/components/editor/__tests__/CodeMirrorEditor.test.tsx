import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import CodeMirrorEditor, { clampEditorLineNumber } from "../CodeMirrorEditor";
import { gitBlameExtension } from "../git-blame-extension";

vi.mock("@codemirror/state", () => ({
  Compartment: class {
    of = vi.fn(() => []);
    reconfigure = vi.fn(() => ({}));
  },
}));

// Mock CodeMirror view — only EditorView is imported directly by CodeMirrorEditor now
vi.mock("@codemirror/view", () => {
  class MockEditorView {
    static updateListener = { of: vi.fn(() => []) };
    destroy = vi.fn();
    dispatch = vi.fn();
    focus = vi.fn();
    state = { doc: { toString: () => "", length: 0 }, selection: { main: { head: 0 } } };
  }
  return {
    EditorView: MockEditorView,
    lineNumbers: vi.fn(() => []),
    highlightActiveLine: vi.fn(() => []),
    drawSelection: vi.fn(() => []),
    keymap: { of: vi.fn(() => []) },
  };
});

const baseEditorProps = vi.fn();

// Mock BaseCodeMirrorEditor to render a simple div with the className
vi.mock("../BaseCodeMirrorEditor", () => ({
  default: ({
    className,
    initialContent,
    editorViewRef,
  }: {
    className?: string;
    initialContent?: string;
    editorViewRef?: React.MutableRefObject<unknown>;
  }) => {
    baseEditorProps({ className, initialContent });
    if (editorViewRef) {
      editorViewRef.current = {
        state: { doc: { toString: () => "", length: 0 } },
        dispatch: vi.fn(),
        destroy: vi.fn(),
      };
    }
    return (
      <div className={className} data-testid="base-editor" data-initial-content={initialContent} />
    );
  },
}));

vi.mock("../language-extensions", () => ({
  getLanguageExtension: vi.fn(() => null),
}));

vi.mock("../editorSaveRegistry", () => ({
  registerSave: vi.fn(),
  unregisterSave: vi.fn(),
}));

vi.mock("../git-blame-extension", () => ({
  gitBlameExtension: vi.fn(() => []),
}));

vi.mock("../editor-search/search-extension", () => ({
  bufferSearchExtension: vi.fn(() => []),
}));

vi.mock("../editor-search/EditorSearchPanel", () => ({
  default: () => null,
}));

let mockReadFileReturn: { data: unknown; isLoading: boolean; error: Error | null } = {
  data: undefined,
  isLoading: true,
  error: null,
};

interface BlameLine {
  line: number;
  sha: string;
  author: string;
  date: string;
}
let mockBlameReturn: { data: { lines: BlameLine[] } | undefined } = { data: undefined };

vi.mock("@/api/generated", () => ({
  useReadFile: vi.fn(() => mockReadFileReturn),
  useWriteFile: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useGetBlame: vi.fn(() => mockBlameReturn),
  useGetFeatureWorkingDir: vi.fn(() => ({ data: undefined })),
}));

vi.mock("@/lib/lsp/useLsp", () => ({
  useLsp: vi.fn(() => ({
    extension: [],
    status: "unsupported",
    languageId: null,
    errorMessage: undefined,
  })),
}));

const mockSetDirty = vi.fn();

vi.mock("@/stores/editor-store", () => ({
  useEditorStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      setDirty: mockSetDirty,
      setCursorPosition: vi.fn(),
      features: {
        1: {
          panes: {
            "pane-1": {
              tabs: [{ filePath: "/test.ts", cursorPosition: { line: 1, col: 1 } }],
            },
          },
        },
      },
    }),
  ),
}));

let mockDebouncedSettings: Record<string, string> = {};

vi.mock("@/hooks/useDebouncedSetting", () => ({
  useDebouncedSetting: vi.fn((key: string) => ({
    value: mockDebouncedSettings[key] ?? "false",
  })),
}));

const defaultProps = {
  filePath: "/test.ts",
  projectId: 42,
  paneId: "pane-1",
  featureId: 1,
  searchOpen: false,
  searchReopenSignal: 0,
  onCloseSearch: () => {},
};

beforeEach(() => {
  mockReadFileReturn = { data: undefined, isLoading: true, error: null };
  mockBlameReturn = { data: undefined };
  mockDebouncedSettings = {};
  baseEditorProps.mockClear();
  mockSetDirty.mockClear();
  vi.mocked(gitBlameExtension).mockClear();
});

describe("CodeMirrorEditor", () => {
  it("renders a spinner and does not mount the editor while loading", () => {
    mockReadFileReturn = { data: undefined, isLoading: true, error: null };
    const { container } = render(<CodeMirrorEditor {...defaultProps} />);

    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    expect(screen.queryByTestId("base-editor")).not.toBeInTheDocument();
    expect(baseEditorProps).not.toHaveBeenCalled();
  });

  it("renders an error message and does not mount the editor on error", () => {
    mockReadFileReturn = { data: undefined, isLoading: false, error: new Error("Not found") };
    render(<CodeMirrorEditor {...defaultProps} />);

    expect(screen.getByText("Not found")).toBeInTheDocument();
    expect(screen.queryByTestId("base-editor")).not.toBeInTheDocument();
    expect(baseEditorProps).not.toHaveBeenCalled();
  });

  it("mounts the editor with initialContent once data is loaded", () => {
    mockReadFileReturn = { data: { content: "hello" }, isLoading: false, error: null };
    const { container } = render(<CodeMirrorEditor {...defaultProps} />);

    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
    expect(screen.getByTestId("base-editor")).toBeInTheDocument();
    expect(baseEditorProps).toHaveBeenCalledWith(
      expect.objectContaining({ initialContent: "hello" }),
    );
  });

  it("renders status bar with language and position", () => {
    mockReadFileReturn = { data: { content: "hello" }, isLoading: false, error: null };
    render(<CodeMirrorEditor {...defaultProps} />);

    expect(screen.getByText("Ln 1, Col 1")).toBeInTheDocument();
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
    expect(screen.getByText("UTF-8")).toBeInTheDocument();
  });

  it("applies the blame extension once the editor mounts even if blame data arrived earlier", () => {
    // Blame is enabled and blame data is already available, but the file content
    // hasn't loaded yet — so the editor isn't mounted on the first render.
    mockDebouncedSettings["editor_git_blame"] = "true";
    mockBlameReturn = { data: { lines: [{ line: 1, sha: "abc", author: "x", date: "now" }] } };
    mockReadFileReturn = { data: undefined, isLoading: true, error: null };

    const { rerender } = render(<CodeMirrorEditor {...defaultProps} />);

    // Spinner state: editor not mounted, blame extension not constructed.
    expect(screen.queryByTestId("base-editor")).not.toBeInTheDocument();
    expect(gitBlameExtension).not.toHaveBeenCalled();

    // File content arrives → editor mounts → blame effect must re-run.
    mockReadFileReturn = { data: { content: "hello" }, isLoading: false, error: null };
    rerender(<CodeMirrorEditor {...defaultProps} />);

    expect(screen.getByTestId("base-editor")).toBeInTheDocument();
    expect(gitBlameExtension).toHaveBeenCalledWith(mockBlameReturn.data?.lines);
  });

  it("clears stale isDirty exactly once per mount, not on later data updates", () => {
    mockReadFileReturn = { data: undefined, isLoading: true, error: null };
    const { rerender } = render(<CodeMirrorEditor {...defaultProps} />);

    // Mount fires the reset once — stale `isDirty` from a prior open is cleared
    // before the user can see it, regardless of whether disk content has arrived.
    expect(mockSetDirty).toHaveBeenCalledTimes(1);
    expect(mockSetDirty).toHaveBeenCalledWith(1, "pane-1", "/test.ts", false);

    // Disk content arriving (a `data` identity change) must NOT re-clear dirty,
    // otherwise a later refetch would wipe genuine in-editor edits.
    mockReadFileReturn = { data: { content: "hello" }, isLoading: false, error: null };
    rerender(<CodeMirrorEditor {...defaultProps} />);
    expect(mockSetDirty).toHaveBeenCalledTimes(1);

    mockReadFileReturn = { data: { content: "hello updated" }, isLoading: false, error: null };
    rerender(<CodeMirrorEditor {...defaultProps} />);
    expect(mockSetDirty).toHaveBeenCalledTimes(1);
  });

  it("clamps invalid pending go-to lines to the document range", () => {
    expect(clampEditorLineNumber(0, 213)).toBe(1);
    expect(clampEditorLineNumber(-5, 213)).toBe(1);
    expect(clampEditorLineNumber(999, 213)).toBe(213);
    expect(clampEditorLineNumber(10, 213)).toBe(10);
  });
});
