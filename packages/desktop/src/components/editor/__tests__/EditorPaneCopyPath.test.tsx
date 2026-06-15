import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render } from "@/test-utils";
import EditorPane from "../EditorPane";

// Capture every scoped global shortcut handler EditorPane registers, keyed by
// id, so we can fire just the editor-copy-path chord in isolation.
interface CapturedShortcut {
  callback: ((e: KeyboardEvent) => void) | null;
  enabled: boolean;
}
const captured: Record<string, CapturedShortcut> = {};

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

const copyFilePathMock = vi.hoisted(() => vi.fn());
vi.mock("../copyFilePath", () => ({
  copyFilePath: (path: string | null | undefined) => copyFilePathMock(path),
}));

const storeState = {
  features: {
    7: {
      activePaneId: "main",
      panes: {
        main: { tabs: [], activeFilePath: "packages/desktop/src/foo.ts" },
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

vi.mock("../EditorSubTabs", () => ({ default: () => <div data-testid="editor-subtabs" /> }));
vi.mock("../CodeMirrorEditor", () => ({ default: () => <div data-testid="codemirror" /> }));
vi.mock("../editor-search/search-cache", () => ({ clearPaneSearch: vi.fn() }));

beforeEach(() => {
  for (const key of Object.keys(captured)) delete captured[key];
  copyFilePathMock.mockClear();
  storeState.features[7] = {
    activePaneId: "main",
    panes: { main: { tabs: [], activeFilePath: "packages/desktop/src/foo.ts" } },
  };
});

function pressCopyPath(): void {
  const event = new KeyboardEvent("keydown");
  Object.defineProperty(event, "preventDefault", { value: vi.fn() });
  Object.defineProperty(event, "stopPropagation", { value: vi.fn() });
  act(() => captured["editor-copy-path"]?.callback?.(event));
}

describe("EditorPane Cmd+Shift+C copy-path shortcut", () => {
  it("registers the shortcut as enabled when this pane is focused", () => {
    render(<EditorPane featureId={7} paneId="main" projectId={1} isActive />);
    expect(captured["editor-copy-path"]?.enabled).toBe(true);
  });

  it("copies the active file path when fired", () => {
    render(<EditorPane featureId={7} paneId="main" projectId={1} isActive />);
    pressCopyPath();
    expect(copyFilePathMock).toHaveBeenCalledWith("packages/desktop/src/foo.ts");
  });

  it("still fires the helper with null when no file is active (helper handles the no-op toast)", () => {
    storeState.features[7] = {
      activePaneId: "main",
      panes: { main: { tabs: [], activeFilePath: null } },
    };
    render(<EditorPane featureId={7} paneId="main" projectId={1} isActive />);
    pressCopyPath();
    expect(copyFilePathMock).toHaveBeenCalledWith(null);
  });

  it("is disabled and does not copy when this pane is not the focused pane", () => {
    storeState.features[7] = {
      activePaneId: "other",
      panes: { main: { tabs: [], activeFilePath: "packages/desktop/src/foo.ts" } },
    };
    render(<EditorPane featureId={7} paneId="main" projectId={1} isActive />);
    expect(captured["editor-copy-path"]?.enabled).toBe(false);
    pressCopyPath();
    expect(copyFilePathMock).not.toHaveBeenCalled();
  });
});
