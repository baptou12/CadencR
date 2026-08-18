import { afterEach, describe, expect, it, vi } from "vitest";
import { revealPickerItem } from "./RuntimeModelPickerChrome";

function mockRect(partial: Partial<DOMRect>): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON() {
      return this;
    },
    ...partial,
  };
}

describe("revealPickerItem", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scrolls a row out from under its sticky group heading", () => {
    const list = document.createElement("div");
    const group = document.createElement("div");
    group.setAttribute("cmdk-group", "");
    const heading = document.createElement("div");
    heading.setAttribute("cmdk-group-heading", "");
    const item = document.createElement("div");
    group.append(heading, item);
    list.append(group);
    list.scrollTop = 40;

    vi.spyOn(list, "getBoundingClientRect").mockReturnValue(mockRect({ top: 100, bottom: 400 }));
    vi.spyOn(heading, "getBoundingClientRect").mockReturnValue(mockRect({ height: 36 }));
    vi.spyOn(item, "getBoundingClientRect").mockReturnValue(mockRect({ top: 110, bottom: 160 }));

    revealPickerItem(list, item);

    expect(list.scrollTop).toBe(14);
  });

  it("scrolls a clipped row up from the bottom of the list", () => {
    const list = document.createElement("div");
    const item = document.createElement("div");
    list.append(item);
    list.scrollTop = 80;

    vi.spyOn(list, "getBoundingClientRect").mockReturnValue(mockRect({ top: 100, bottom: 400 }));
    vi.spyOn(item, "getBoundingClientRect").mockReturnValue(mockRect({ top: 360, bottom: 430 }));

    revealPickerItem(list, item);

    expect(list.scrollTop).toBe(110);
  });
});
