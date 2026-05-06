import { describe, expect, it } from "vitest";
import { getRuntimeConfig, setRuntimeConfig } from "./runtime-config";

describe("runtime-config", () => {
  it("stores the runtime API endpoint and token", () => {
    setRuntimeConfig({ baseUrl: "http://127.0.0.1:5004", authToken: "token" });

    expect(getRuntimeConfig()).toEqual({ baseUrl: "http://127.0.0.1:5004", authToken: "token" });
  });
});
