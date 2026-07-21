import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { useEditorStore } from "@/stores/editor-store";
import type { ConflictContentSnapshot } from "@/api/generated";

const mocks = vi.hoisted(() => ({ save: vi.fn(), saveQuiet: vi.fn() }));

vi.mock("@/hooks/useDebouncedSetting", () => ({
  useDebouncedSetting: () => ({ value: "false", setValue: vi.fn(), isLoading: false }),
}));
vi.mock("@/hooks/useEditorLanguage", () => ({
  useEditorLanguage: () => ({ languageId: "typescript" }),
}));
vi.mock("./useEditorFormat", () => ({ useEditorFormat: () => ({ beforeWrite: undefined }) }));
vi.mock("./useEditorSave", () => ({
  useEditorSave: () => ({
    save: mocks.save,
    saveQuiet: mocks.saveQuiet,
    autoSavedVisible: false,
    isSaving: false,
    errorMessage: null,
  }),
}));
vi.mock("./editorSaveRegistry", () => ({ registerSave: vi.fn(), unregisterSave: vi.fn() }));
vi.mock("./ConflictUnifiedEditor", () => ({
  default: ({ onChange, onSave }: { onChange?: () => void; onSave?: () => void }) => (
    <div>
      <div>CodeMirror unified merge view</div>
      <button type="button" onClick={onChange}>
        Edit Result
      </button>
      <button type="button" onClick={onSave}>
        CodeMirror Save
      </button>
    </div>
  ),
}));

import ConflictResultResolver from "./ConflictResultResolver";

const snapshot = {
  file_path: "conflict.ts",
  conflict_kind: "uu",
  operation: "merge",
  presentation: { mode: "three_way" },
  base: { content: { state: "text", content: "base\n" } },
  stage_2: { content: { state: "text", content: "ours\n" } },
  stage_3: { content: { state: "text", content: "theirs\n" } },
  result: {
    content: {
      state: "text",
      content: "ours\n",
    },
  },
} as ConflictContentSnapshot;

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({ features: {} });
  const store = useEditorStore.getState();
  store.initFeature(7);
  store.openFile(7, "main", "conflict.ts");
  mocks.save.mockImplementation(async () => {
    useEditorStore.getState().setDirty(7, "main", "conflict.ts", false);
  });
});

describe("ConflictResultResolver resolution boundary", () => {
  it("renders as a file editor without resolver header or footer controls", async () => {
    const { user } = render(
      <ConflictResultResolver
        featureId={7}
        paneId="main"
        projectId={2}
        filePath="conflict.ts"
        snapshot={snapshot}
      />,
    );
    expect(await screen.findByText("CodeMirror unified merge view")).toBeInTheDocument();
    // Reads as an ordinary file editor: no comparison toolbar, file header, or
    // Save/Stage footer controls — resolution lives inline in CodeMirror.
    expect(screen.queryByText("Compare Result with")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Incoming branch" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Resolve conflict.ts" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Result" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stage resolved file" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit Result" }));
    expect(
      useEditorStore
        .getState()
        .features[7]?.panes.main?.tabs.find((tab) => tab.filePath === "conflict.ts")?.isDirty,
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "CodeMirror Save" }));
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it("keeps staging out of the file editor while conflict markers remain", async () => {
    const unresolvedSnapshot = {
      ...snapshot,
      result: {
        content: {
          state: "text",
          content: "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> topic\n",
        },
      },
    } as ConflictContentSnapshot;
    render(
      <ConflictResultResolver
        featureId={7}
        paneId="main"
        projectId={2}
        filePath="conflict.ts"
        snapshot={unresolvedSnapshot}
      />,
    );

    expect(await screen.findByText("CodeMirror unified merge view")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Stage/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Resolve every marker block/)).not.toBeInTheDocument();
  });
});
