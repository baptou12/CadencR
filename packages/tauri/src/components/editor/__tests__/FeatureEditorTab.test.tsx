import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@/test-utils";
import FeatureEditorTab from "../FeatureEditorTab";

const mockUseFileWatcher = vi.fn();
const mockSplitEditorPane = vi.fn();
const mockNavigatePane = vi.fn();
const mockInitFeature = vi.fn();
const mockToggleSidebar = vi.fn();
const mockPersistCollapsed = vi.fn();
const mockUseDebouncedSetting = vi.fn<
  (
    key: string,
    debounceMs?: number,
  ) => {
    value: string | null;
    setValue: typeof mockPersistCollapsed;
  }
>(() => ({ value: null, setValue: mockPersistCollapsed }));

vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn(),
}));

vi.mock("@/hooks/useGlobalShortcut", () => ({
  useGlobalShortcut: vi.fn(),
}));

vi.mock("@/hooks/useFileWatcher", () => ({
  useFileWatcher: (projectPath: string) => mockUseFileWatcher(projectPath),
}));

vi.mock("@/stores/feature-layout-store", () => ({
  // Test always considers the editor visible — exercises the hotkey paths.
  useFeatureLayoutStore: vi.fn(() => true),
  selectFeatureLayout: () => () => ({}),
  isTabVisible: () => true,
}));

vi.mock("@/hooks/useDebouncedSetting", () => ({
  useDebouncedSetting: (key: string, debounceMs?: number) =>
    mockUseDebouncedSetting(key, debounceMs),
}));

vi.mock("@/hooks/useEditorState", () => ({
  useEditorState: vi.fn(() => ({
    initFeature: mockInitFeature,
    splitTree: { id: "root" },
    activePaneId: "pane-1",
    sidebarVisible: false,
    toggleSidebar: mockToggleSidebar,
    panes: {
      "pane-1": {
        tabs: [],
      },
    },
  })),
}));

vi.mock("@/stores/editor-store", () => ({
  useEditorStore: vi.fn(
    (
      selector: (state: {
        splitEditorPane: typeof mockSplitEditorPane;
        navigatePane: typeof mockNavigatePane;
      }) => unknown,
    ) => selector({ splitEditorPane: mockSplitEditorPane, navigatePane: mockNavigatePane }),
  ),
}));

vi.mock("../FileTree", () => ({
  default: () => <div data-testid="file-tree" />,
}));

vi.mock("../EditorSplitTree", () => ({
  default: () => <div data-testid="editor-split-tree" />,
}));

vi.mock("../FileSearchDialog", () => ({
  default: () => null,
}));

vi.mock("../ContentSearchDialog", () => ({
  default: () => null,
}));

vi.mock("../editorSaveRegistry", () => ({
  saveAll: vi.fn(),
}));

vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

describe("FeatureEditorTab", () => {
  beforeEach(() => {
    mockUseFileWatcher.mockReset();
    mockSplitEditorPane.mockReset();
    mockNavigatePane.mockReset();
    mockInitFeature.mockReset();
    mockToggleSidebar.mockReset();
    mockPersistCollapsed.mockReset();
    mockUseDebouncedSetting.mockReset();
    mockUseDebouncedSetting.mockReturnValue({ value: null, setValue: mockPersistCollapsed });
  });

  it("subscribes to file changes even when the file tree sidebar is hidden", () => {
    render(<FeatureEditorTab featureId={1} projectId={1} projectPath="/project" />);

    expect(mockUseFileWatcher).toHaveBeenCalledWith("/project");
    expect(screen.queryByTestId("file-tree")).not.toBeInTheDocument();
    expect(screen.getByTestId("editor-split-tree")).toBeInTheDocument();
  });

  it("uses a workspace-level collapse setting", () => {
    render(<FeatureEditorTab featureId={1} projectId={1} projectPath="/project" />);

    expect(mockUseDebouncedSetting).toHaveBeenCalledWith("editor_sidebar_collapsed", 0);
  });

  it("reserves a rail for the expand button when the sidebar is collapsed", () => {
    render(<FeatureEditorTab featureId={1} projectId={1} projectPath="/project" />);

    const expandButton = screen.getByRole("button", { name: "Show file tree sidebar" });
    expect(expandButton.parentElement).toHaveClass("w-9");
    expect(screen.getByTestId("editor-split-tree")).toBeInTheDocument();
  });

  it("persists the collapsed state when expanding from the rail", async () => {
    const { user } = render(
      <FeatureEditorTab featureId={1} projectId={1} projectPath="/project" />,
    );

    await user.click(screen.getByRole("button", { name: "Show file tree sidebar" }));

    expect(mockToggleSidebar).toHaveBeenCalled();
    expect(mockPersistCollapsed).toHaveBeenCalledWith("false");
  });
});
