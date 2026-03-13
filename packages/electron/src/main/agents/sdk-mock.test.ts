import { describe, it, expect } from "vitest";
import { createMockSdkClient } from "./__mocks__/sdk-client.mock";

describe("createMockSdkClient", () => {
  it("yields messages pushed via emitMessage", async () => {
    const { client, emitMessage, complete } = createMockSdkClient();
    const query = client.query({ prompt: "hello" });

    // Push messages then complete
    emitMessage({ type: "text", text: "response 1" });
    emitMessage({ type: "text", text: "response 2" });
    complete();

    const messages: unknown[] = [];
    for await (const msg of query) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ type: "text", text: "response 1" });
    expect(messages[1]).toEqual({ type: "text", text: "response 2" });
  });

  it("records query options for assertion", () => {
    const { client, getQueries } = createMockSdkClient();
    client.query({ prompt: "test prompt", options: { model: "opus" } });

    expect(getQueries()).toHaveLength(1);
    expect(getQueries()[0].options.prompt).toBe("test prompt");
  });

  it("completes iteration when complete() is called", async () => {
    const { client, complete } = createMockSdkClient();
    const query = client.query({ prompt: "test" });

    complete();

    const result: unknown[] = [];
    for await (const msg of query) {
      result.push(msg);
    }
    expect(result).toHaveLength(0);
  });
});
