import { describe, expect, it, vi } from "vitest";
import { dispatchBrowserBridgePayload } from "./browser-bridge-server";

describe("browser bridge server", () => {
  it("rejects requests without the bearer token", async () => {
    const result = await dispatchBrowserBridgePayload("", "secret", "{}", vi.fn());

    expect(result.status).toBe(401);
  });

  it("dispatches authenticated browser tool requests", async () => {
    const dispatch = vi.fn(async () => ({ text: "tabs: []" }));
    const result = await dispatchBrowserBridgePayload(
      "Bearer secret",
      "secret",
      JSON.stringify({ tool_name: "browser_list_tabs", args: { feature_id: 7 } }),
      dispatch,
    );

    expect(result).toEqual({ status: 200, payload: { text: "tabs: []" } });
    expect(dispatch).toHaveBeenCalledWith("browser_list_tabs", { feature_id: 7 });
  });

  it("passes through an image payload for screenshot tools", async () => {
    const dispatch = vi.fn(async () => ({
      text: '{"format":"png"}',
      image: { mimeType: "image/png", data: "AAAA" },
    }));
    const result = await dispatchBrowserBridgePayload(
      "Bearer secret",
      "secret",
      JSON.stringify({ tool_name: "browser_screenshot", args: {} }),
      dispatch,
    );

    expect(result).toEqual({
      status: 200,
      payload: { text: '{"format":"png"}', image: { mimeType: "image/png", data: "AAAA" } },
    });
  });
});
