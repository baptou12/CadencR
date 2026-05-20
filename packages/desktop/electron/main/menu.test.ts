import { describe, expect, it, vi } from "vitest";

const setApplicationMenu = vi.fn();
const buildFromTemplate = vi.fn((template: unknown) => template);

vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    name: "Cadencr",
  },
  Menu: {
    buildFromTemplate,
    setApplicationMenu,
  },
}));

describe("installApplicationMenu", () => {
  it("does not install Electron zoom role accelerators that bypass persisted app zoom", async () => {
    const { installApplicationMenu } = await import("./menu");

    installApplicationMenu(vi.fn());

    expect(JSON.stringify(buildFromTemplate.mock.calls[0]?.[0])).not.toContain("resetZoom");
    expect(JSON.stringify(buildFromTemplate.mock.calls[0]?.[0])).not.toContain("zoomIn");
    expect(JSON.stringify(buildFromTemplate.mock.calls[0]?.[0])).not.toContain("zoomOut");
    expect(setApplicationMenu).toHaveBeenCalledOnce();
  });
});
