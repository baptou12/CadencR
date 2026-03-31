import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore, DEFAULT_MAX_TABS } from "../editor-store";

const FEATURE_ID = 1;
const PANE_ID = "main";

function getStore() {
  return useEditorStore.getState();
}

function feature() {
  return getStore().features[FEATURE_ID];
}

function pane(paneId = PANE_ID) {
  return feature().panes[paneId];
}

beforeEach(() => {
  useEditorStore.setState({ features: {} });
});

describe("initFeature", () => {
  it("creates default state with one pane", () => {
    getStore().initFeature(FEATURE_ID);
    const f = feature();
    expect(f).toBeDefined();
    expect(f.splitTree).toEqual({ type: "leaf", id: "main" });
    expect(f.panes["main"]).toEqual({ tabs: [], activeFilePath: null });
    expect(f.activePaneId).toBe("main");
    expect(f.sidebarVisible).toBe(true);
  });

  it("does not re-initialize if already exists", () => {
    getStore().initFeature(FEATURE_ID);
    getStore().openFile(FEATURE_ID, PANE_ID, "/foo.ts");
    getStore().initFeature(FEATURE_ID);
    expect(pane().tabs).toHaveLength(1);
  });
});

describe("openFile", () => {
  beforeEach(() => {
    getStore().initFeature(FEATURE_ID);
  });

  it("adds a tab and sets it active", () => {
    getStore().openFile(FEATURE_ID, PANE_ID, "/src/foo.ts");
    const p = pane();
    expect(p.tabs).toHaveLength(1);
    expect(p.tabs[0].filePath).toBe("/src/foo.ts");
    expect(p.tabs[0].fileName).toBe("foo.ts");
    expect(p.activeFilePath).toBe("/src/foo.ts");
  });

  it("focuses existing tab instead of adding duplicate", () => {
    getStore().openFile(FEATURE_ID, PANE_ID, "/src/foo.ts");
    getStore().openFile(FEATURE_ID, PANE_ID, "/src/bar.ts");
    getStore().openFile(FEATURE_ID, PANE_ID, "/src/foo.ts");
    const p = pane();
    expect(p.tabs).toHaveLength(2);
    expect(p.activeFilePath).toBe("/src/foo.ts");
  });

  it("closes oldest non-dirty tab when max tabs exceeded", () => {
    for (let i = 0; i < DEFAULT_MAX_TABS; i++) {
      getStore().openFile(FEATURE_ID, PANE_ID, `/file${i}.ts`);
    }
    expect(pane().tabs).toHaveLength(DEFAULT_MAX_TABS);
    // Open one more — oldest (/file0.ts) should be removed
    getStore().openFile(FEATURE_ID, PANE_ID, "/extra.ts");
    const tabs = pane().tabs;
    expect(tabs).toHaveLength(DEFAULT_MAX_TABS);
    expect(tabs.find((t) => t.filePath === "/file0.ts")).toBeUndefined();
    expect(tabs.find((t) => t.filePath === "/extra.ts")).toBeDefined();
  });

  it("does not close dirty tabs when max exceeded; new non-dirty tab is removed instead", () => {
    for (let i = 0; i < DEFAULT_MAX_TABS; i++) {
      getStore().openFile(FEATURE_ID, PANE_ID, `/file${i}.ts`);
      getStore().setDirty(FEATURE_ID, PANE_ID, `/file${i}.ts`, true);
    }
    getStore().openFile(FEATURE_ID, PANE_ID, "/extra.ts");
    // All existing tabs are dirty; the newly added (non-dirty) tab is the
    // only eviction candidate and gets removed — count stays at max.
    expect(pane().tabs).toHaveLength(DEFAULT_MAX_TABS);
    // None of the dirty tabs should have been removed
    for (let i = 0; i < DEFAULT_MAX_TABS; i++) {
      expect(pane().tabs.find((t) => t.filePath === `/file${i}.ts`)).toBeDefined();
    }
  });

  it("disambiguates tab names when two files share a filename", () => {
    getStore().openFile(FEATURE_ID, PANE_ID, "/a/index.ts");
    getStore().openFile(FEATURE_ID, PANE_ID, "/b/index.ts");
    const tabs = pane().tabs;
    const names = tabs.map((t) => t.disambiguatedName);
    expect(names).toContain("a/index.ts");
    expect(names).toContain("b/index.ts");
  });
});

describe("closeTab", () => {
  beforeEach(() => {
    getStore().initFeature(FEATURE_ID);
  });

  it("removes tab and activates adjacent", () => {
    getStore().openFile(FEATURE_ID, PANE_ID, "/a.ts");
    getStore().openFile(FEATURE_ID, PANE_ID, "/b.ts");
    getStore().openFile(FEATURE_ID, PANE_ID, "/c.ts");
    // Active is /c.ts, close it → should activate /b.ts
    getStore().closeTab(FEATURE_ID, PANE_ID, "/c.ts");
    const p = pane();
    expect(p.tabs).toHaveLength(2);
    expect(p.activeFilePath).toBe("/b.ts");
  });

  it("on last tab leaves pane with no active file", () => {
    getStore().openFile(FEATURE_ID, PANE_ID, "/a.ts");
    getStore().closeTab(FEATURE_ID, PANE_ID, "/a.ts");
    const p = pane();
    expect(p.tabs).toHaveLength(0);
    expect(p.activeFilePath).toBeNull();
  });
});

describe("setDirty", () => {
  beforeEach(() => {
    getStore().initFeature(FEATURE_ID);
    getStore().openFile(FEATURE_ID, PANE_ID, "/a.ts");
  });

  it("marks tab dirty", () => {
    getStore().setDirty(FEATURE_ID, PANE_ID, "/a.ts", true);
    expect(pane().tabs[0].isDirty).toBe(true);
  });

  it("marks tab clean", () => {
    getStore().setDirty(FEATURE_ID, PANE_ID, "/a.ts", true);
    getStore().setDirty(FEATURE_ID, PANE_ID, "/a.ts", false);
    expect(pane().tabs[0].isDirty).toBe(false);
  });
});

describe("toggleSidebar", () => {
  it("toggles sidebar visibility", () => {
    getStore().initFeature(FEATURE_ID);
    expect(feature().sidebarVisible).toBe(true);
    getStore().toggleSidebar(FEATURE_ID);
    expect(feature().sidebarVisible).toBe(false);
    getStore().toggleSidebar(FEATURE_ID);
    expect(feature().sidebarVisible).toBe(true);
  });
});

describe("splitEditorPane", () => {
  it("creates a split node with two leaves", () => {
    getStore().initFeature(FEATURE_ID);
    getStore().splitEditorPane(FEATURE_ID, PANE_ID, "horizontal");
    const f = feature();
    expect(f.splitTree.type).toBe("split");
    if (f.splitTree.type === "split") {
      expect(f.splitTree.children[0].type).toBe("leaf");
      expect(f.splitTree.children[1].type).toBe("leaf");
      expect(f.splitTree.orientation).toBe("horizontal");
    }
    // New pane should be active
    expect(f.activePaneId).not.toBe(PANE_ID);
  });
});

describe("removeEditorPane", () => {
  it("collapses tree when a pane is removed", () => {
    getStore().initFeature(FEATURE_ID);
    getStore().splitEditorPane(FEATURE_ID, PANE_ID, "horizontal");
    const newPaneId = feature().activePaneId;
    getStore().removeEditorPane(FEATURE_ID, newPaneId);
    const f = feature();
    expect(f.splitTree.type).toBe("leaf");
    expect(f.splitTree.type === "leaf" && f.splitTree.id).toBe(PANE_ID);
  });

  it("does not remove the last pane", () => {
    getStore().initFeature(FEATURE_ID);
    getStore().removeEditorPane(FEATURE_ID, PANE_ID);
    expect(feature().splitTree).toEqual({ type: "leaf", id: PANE_ID });
  });
});

describe("navigatePane", () => {
  it("finds correct adjacent pane", () => {
    getStore().initFeature(FEATURE_ID);
    // Split to create: [main | newPane]
    getStore().splitEditorPane(FEATURE_ID, PANE_ID, "horizontal");
    const newPaneId = feature().activePaneId;
    // active is newPane (right side), navigate left → should go to main
    getStore().navigatePane(FEATURE_ID, "left");
    expect(feature().activePaneId).toBe(PANE_ID);
    // navigate right → should go back to newPane
    getStore().navigatePane(FEATURE_ID, "right");
    expect(feature().activePaneId).toBe(newPaneId);
  });

  it("does not change pane when no adjacent pane exists", () => {
    getStore().initFeature(FEATURE_ID);
    getStore().navigatePane(FEATURE_ID, "left");
    expect(feature().activePaneId).toBe(PANE_ID);
  });
});
