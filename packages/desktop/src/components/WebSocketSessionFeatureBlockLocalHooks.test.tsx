import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@/test-utils";
import { useEditorStore } from "@/stores/editor-store";
import type { useSessionRefs } from "./WebSocketSessionFeatureBlockHooks";

const mocks = vi.hoisted(() => ({
  activateFeatureTab: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));
vi.mock("@/stores/feature-layout-store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/stores/feature-layout-store")>();
  return { ...original, activateFeatureTab: mocks.activateFeatureTab };
});

import { useOpenDiffFileInEditor } from "./WebSocketSessionFeatureBlockLocalHooks";

const featureId = 45;
const refs = {
  editor: { current: { focusActiveEditor: vi.fn() } },
} as unknown as ReturnType<typeof useSessionRefs>;

function open() {
  return renderHook(() =>
    useOpenDiffFileInEditor({ featureId, layoutFeatureId: featureId, rootPath: "/repo", refs }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({ features: {} });
});

describe("useOpenDiffFileInEditor", () => {
  it("opens a repo-relative file as an ordinary tab and reveals the editor", () => {
    const { result } = open();
    act(() => result.current("/repo/src/conflict.ts", 4));

    const tab = useEditorStore.getState().features[featureId].panes.main.tabs[0];
    expect(tab).toMatchObject({ filePath: "src/conflict.ts", pendingGoToLine: 4 });
    // Resolver mode is derived directly from backend-confirmed Git status,
    // never stored by the open call itself.
    expect(mocks.activateFeatureTab).toHaveBeenCalledWith(featureId, "editor");
  });

  it("focuses an already-open file instead of duplicating the tab", () => {
    const store = useEditorStore.getState();
    store.initFeature(featureId);
    store.openFile(featureId, "main", "src/conflict.ts");
    const { result } = open();
    act(() => result.current("/repo/src/conflict.ts", 9));

    const tabs = useEditorStore.getState().features[featureId].panes.main.tabs;
    expect(tabs.map((tab) => tab.filePath)).toEqual(["src/conflict.ts"]);
    expect(tabs[0].pendingGoToLine).toBe(9);
  });
});
