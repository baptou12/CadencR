import { afterEach, describe, expect, it } from "vitest";
import { requestUnifiedAgentsSearchFocus } from "@/components/unified-agents-events";

describe("unified agents search focus events", () => {
  afterEach((): void => {
    document.body.innerHTML = "";
  });

  it("focuses the filter textbox and moves the caret to the end", () => {
    const textbox = document.createElement("div");
    textbox.setAttribute("role", "textbox");
    textbox.setAttribute("aria-label", "Filter agents");
    textbox.setAttribute("contenteditable", "true");
    textbox.textContent = "agent filter";
    document.body.append(textbox);

    requestUnifiedAgentsSearchFocus();

    const selection = window.getSelection();
    expect(document.activeElement).toBe(textbox);
    expect(selection?.anchorNode).toBe(textbox);
    expect(selection?.anchorOffset).toBe(textbox.childNodes.length);
  });
});
