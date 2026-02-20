import { describe, it, expect, afterEach } from "vitest";
import { getSdkClient, setSdkClient } from "./sdk-client";
import { createMockSdkClient } from "./__mocks__/sdk-client.mock";

describe("sdk-client", () => {
  afterEach(() => {
    setSdkClient(null);
  });

  it("returns the injected mock client when set", async () => {
    const { client } = createMockSdkClient();
    setSdkClient(client);
    const result = await getSdkClient();
    expect(result).toBe(client);
  });

  it("returns mock on repeated calls", async () => {
    const { client } = createMockSdkClient();
    setSdkClient(client);
    const a = await getSdkClient();
    const b = await getSdkClient();
    expect(a).toBe(b);
    expect(a).toBe(client);
  });
});
