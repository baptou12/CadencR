import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render } from "@/test-utils";
import EditorPane from "../EditorPane";

// Capture every scoped global shortcut handler registered by EditorPane,
// keyed by id, so individual tests can fire just the chord they're checking.
// EditorPane now registers `editor-buffer-search`, `editor-replace`, and
// `editor-go-to-line` — keeping them addressable separately is essential.
interface CapturedShortcut {
  callback: ((e: KeyboardEvent) => void) | null;
  enabled: boolean;
}
const captured: Record<string, CapturedShortcut> = {};

interface CapturedEditor {
  searchOpen: boolean;
  searchReopenSignal: number;
  renders: number;
}
const editor: CapturedEditor = { searchOpen: false, searchReopenSignal: 0, renders: 0 };

vi.mock("@/hooks/useShortcut", () => ({
  useScopedGlobalShortcutById: (
    id: string,
    callback: (e: KeyboardEvent) => void,
    _scope: string,
    options?: { enabled?: boolean },
  ) => {
    captured[id] = { callback, enabled: options?.enabled ?? true };
  },
}));

const storeState = {
  features: {
    7: {
      activePaneId: "main",
      panes: {
        main: { tabs: [], activeFilePath: "/file.ts" },
      },
    },
  } as Record<
    number,
    {
      activePaneId: string;
      panes: Record<string, { tabs: unknown[]; activeFilePath: string | null }>;
    }
  >,
  setActivePane: vi.fn(),
};

vi.mock("@/stores/editor-store", () => ({
  useEditorStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
  isUntitledPath: (path: string | null | undefined) =>
    typeof path === "string" && path.startsWith("untitled://"),
}));

vi.mock("../EditorSubTabs", () => ({
  default: () => <div data-testid="editor-subtabs" />,
}));

vi.mock("../CodeMirrorEditor", () => ({
  default: (props: { searchOpen: boolean; searchReopenSignal: number }) => {
    editor.renders += 1;
    editor.searchOpen = props.searchOpen;
    editor.searchReopenSignal = props.searchReopenSignal;
    return <div data-testid="codemirror" />;
  },
}));

const clearPaneSearchMock = vi.fn();
vi.mock("../editor-search/search-cache", () => ({
  clearPaneSearch: (...args: unknown[]) => clearPaneSearchMock(...args),
}));

beforeEach(() => {
  for (const key of Object.keys(captured)) delete captured[key];
  editor.searchOpen = false;
  editor.searchReopenSignal = 0;
  editor.renders = 0;
  clearPaneSearchMock.mockClear();
  storeState.features[7] = {
    activePaneId: "main",
    panes: { main: { tabs: [], activeFilePath: "/file.ts" } },
  };
});

function press(id: string = "editor-buffer-search"): void {
  const event = new KeyboardEvent("keydown");
  Object.defineProperty(event, "preventDefault", { value: vi.fn() });
  Object.defineProperty(event, "stopPropagation", { value: vi.fn() });
  act(() => captured[id]?.callback?.(event));
}

describe("EditorPane Cmd+F shortcut", () => {
  it("registers the editor-buffer-search shortcut as enabled when this pane is focused and has a file", () => {
    render(<EditorPane featureId={7} paneId="main" projectId={1} isActive />);
    expect(captured["editor-buffer-search"]?.enabled).toBe(true);
  });

  it("opens the search panel on first press", () => {
    render(<EditorPane featureId={7} paneId="main" projectId={1} isActive />);
    expect(editor.searchOpen).toBe(false);
    press();
    expect(editor.searchOpen).toBe(true);
  });

  it("bumps reopenSignal on a second press while already open", () => {
    render(<EditorPane featureId={7} paneId="main" projectId={1} isActive />);
    press();
    const firstSignal = editor.searchReopenSignal;
    press();
    expect(editor.searchOpen).toBe(true);
    expect(editor.searchReopenSignal).toBeGreaterThan(firstSignal);
  });

  it("disables the shortcut when no file is open", () => {
    storeState.features[7] = {
      activePaneId: "main",
      panes: { main: { tabs: [], activeFilePath: null } },
    };
    render(<EditorPane featureId={7} paneId="main" projectId={1} isActive />);
    expect(captured["editor-buffer-search"]?.enabled).toBe(false);
  });

  it("disables the shortcut when this pane is not the focused pane", () => {
    storeState.features[7] = {
      activePaneId: "other",
      panes: { main: { tabs: [], activeFilePath: "/file.ts" } },
    };
    render(<EditorPane featureId={7} paneId="main" projectId={1} isActive />);
    expect(captured["editor-buffer-search"]?.enabled).toBe(false);
  });

  it("clears the per-pane search cache on unmount", () => {
    const { unmount } = render(<EditorPane featureId={7} paneId="main" projectId={1} isActive />);
    unmount();
    expect(clearPaneSearchMock).toHaveBeenCalledWith(7, "main");
  });
});
