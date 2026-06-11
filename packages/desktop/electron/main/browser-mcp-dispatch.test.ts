import { describe, expect, it, vi } from "vitest";
import { dispatchBrowserMcpTool, type BrowserMcpTarget } from "./browser-mcp-dispatch";

function target(): BrowserMcpTarget {
  return {
    state: vi.fn(() => ({
      tabs: [],
      activeTabId: null,
      consoleEntries: [],
      networkEntries: [],
      error: null,
    })),
    createTab: vi.fn(() => ({
      id: "tab-1",
      title: "New",
      url: "about:blank",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      sessionProfileId: "ephemeral",
      isActive: true,
      devToolsOpen: false,
    })),
    navigate: vi.fn(),
    snapshot: vi.fn(async () => ({ documents: [] })),
    screenshot: vi.fn(async () => "png"),
    click: vi.fn(async () => undefined),
    typeText: vi.fn(async () => undefined),
    keypress: vi.fn(async () => undefined),
    selectElementContext: vi.fn(async () => ({ ok: true })),
  };
}

describe("dispatchBrowserMcpTool", () => {
  it("serializes browser_list_tabs state as JSON text", async () => {
    const fake = target();
    await expect(dispatchBrowserMcpTool(fake, "browser_list_tabs", {})).resolves.toBe(
      JSON.stringify(fake.state()),
    );
  });

  it("opens a URL in a new tab when no tab id is supplied", async () => {
    const fake = target();
    await dispatchBrowserMcpTool(fake, "browser_open_url", { url: "http://localhost:3000" });

    expect(fake.createTab).toHaveBeenCalledWith("http://localhost:3000");
  });

  it("navigates an existing tab when browser_open_url includes tab_id", async () => {
    const fake = target();
    vi.mocked(fake.navigate).mockReturnValue({
      id: "tab-1",
      title: "Existing",
      url: "http://localhost:3000",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      sessionProfileId: "ephemeral",
      isActive: true,
      devToolsOpen: false,
    });

    await dispatchBrowserMcpTool(fake, "browser_open_url", {
      tab_id: "tab-1",
      url: "http://localhost:3000",
    });

    expect(fake.navigate).toHaveBeenCalledWith("tab-1", "http://localhost:3000");
    expect(fake.createTab).not.toHaveBeenCalled();
  });

  it("requires coordinates for browser_click", async () => {
    await expect(
      dispatchBrowserMcpTool(target(), "browser_click", { tab_id: "tab-1" }),
    ).rejects.toThrow("x");
  });

  it("allows mutating tools without agent-supplied active_tab_url on localhost tabs", async () => {
    const fake = target();
    vi.mocked(fake.state).mockReturnValue({
      tabs: [
        {
          id: "tab-1",
          title: "Local",
          url: "http://localhost:5173/signup",
          loading: false,
          canGoBack: false,
          canGoForward: false,
          sessionProfileId: "ephemeral",
          isActive: true,
          devToolsOpen: false,
        },
      ],
      activeTabId: "tab-1",
      consoleEntries: [],
      networkEntries: [],
      error: null,
    });

    await dispatchBrowserMcpTool(fake, "browser_click", { x: 12, y: 34 });

    expect(fake.click).toHaveBeenCalledWith("tab-1", 12, 34);
  });

  it("throws when a tab-scoped tool has no active tab", async () => {
    const fake = target();

    await expect(dispatchBrowserMcpTool(fake, "browser_screenshot", {})).rejects.toThrow(
      "No active browser tab",
    );
  });

  it("throws for unknown tools", async () => {
    await expect(dispatchBrowserMcpTool(target(), "browser_launch_missiles", {})).rejects.toThrow(
      "Unknown Browser MCP tool",
    );
  });
});
