import { describe, it, expect, beforeEach } from "vitest";
import {
  useEditorStore,
  DEFAULT_MAX_TABS,
  isUntitledPath,
  UNTITLED_PATH_PREFIX,
} from "../editor-store";

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

  it("keeps the same state when the dirty flag is already settled", () => {
    getStore().setDirty(FEATURE_ID, PANE_ID, "/a.ts", true);
    const settled = getStore().features[FEATURE_ID];
    getStore().setDirty(FEATURE_ID, PANE_ID, "/a.ts", true);
    expect(getStore().features[FEATURE_ID]).toBe(settled);
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

describe("openUntitledBuffer", () => {
  beforeEach(() => {
    getStore().initFeature(FEATURE_ID);
  });

  it("opens an empty dirty Untitled-1 tab and returns its synthetic path", () => {
    const path = getStore().openUntitledBuffer(FEATURE_ID, PANE_ID);
    expect(isUntitledPath(path)).toBe(true);
    expect(path.startsWith(UNTITLED_PATH_PREFIX)).toBe(true);
    const p = pane();
    expect(p.tabs).toHaveLength(1);
    expect(p.tabs[0].fileName).toBe("Untitled-1");
    expect(p.tabs[0].isDirty).toBe(true);
    expect(p.activeFilePath).toBe(path);
  });

  it("increments the Untitled-N counter per pane", () => {
    getStore().openUntitledBuffer(FEATURE_ID, PANE_ID);
    getStore().openUntitledBuffer(FEATURE_ID, PANE_ID);
    const names = pane().tabs.map((t) => t.fileName);
    expect(names).toEqual(["Untitled-1", "Untitled-2"]);
  });

  it("re-uses freed Untitled numbers after one is closed", () => {
    const p1 = getStore().openUntitledBuffer(FEATURE_ID, PANE_ID);
    getStore().openUntitledBuffer(FEATURE_ID, PANE_ID);
    getStore().closeTab(FEATURE_ID, PANE_ID, p1);
    getStore().openUntitledBuffer(FEATURE_ID, PANE_ID);
    const names = pane()
      .tabs.map((t) => t.fileName)
      .sort();
    expect(names).toEqual(["Untitled-1", "Untitled-2"]);
  });
});

describe("convertUntitledToFile", () => {
  beforeEach(() => {
    getStore().initFeature(FEATURE_ID);
  });

  it("renames the untitled tab in place and clears the dirty flag", () => {
    const untitled = getStore().openUntitledBuffer(FEATURE_ID, PANE_ID);
    getStore().convertUntitledToFile(FEATURE_ID, PANE_ID, untitled, "notes.md");
    const p = pane();
    expect(p.tabs).toHaveLength(1);
    expect(p.tabs[0].filePath).toBe("notes.md");
    expect(p.tabs[0].fileName).toBe("notes.md");
    expect(p.tabs[0].isDirty).toBe(false);
    expect(p.activeFilePath).toBe("notes.md");
  });

  it("preserves tab position when there are other tabs around it", () => {
    getStore().openFile(FEATURE_ID, PANE_ID, "/before.ts");
    const untitled = getStore().openUntitledBuffer(FEATURE_ID, PANE_ID);
    getStore().openFile(FEATURE_ID, PANE_ID, "/after.ts");
    getStore().convertUntitledToFile(FEATURE_ID, PANE_ID, untitled, "src/notes.md");
    const paths = pane().tabs.map((t) => t.filePath);
    expect(paths).toEqual(["/before.ts", "src/notes.md", "/after.ts"]);
  });

  it("drops the untitled tab when the destination is already open", () => {
    getStore().openFile(FEATURE_ID, PANE_ID, "existing.ts");
    const untitled = getStore().openUntitledBuffer(FEATURE_ID, PANE_ID);
    getStore().convertUntitledToFile(FEATURE_ID, PANE_ID, untitled, "existing.ts");
    const p = pane();
    expect(p.tabs).toHaveLength(1);
    expect(p.tabs[0].filePath).toBe("existing.ts");
    expect(p.activeFilePath).toBe("existing.ts");
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
