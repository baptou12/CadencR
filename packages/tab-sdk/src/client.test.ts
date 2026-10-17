import { describe, expect, it, vi } from "vitest";
import { connected, flush } from "./test-utils.js";
import { createTabContext } from "./testing/index.js";

describe("requests", () => {
  it("correlates concurrent responses by id", async () => {
    const { host, client } = await connected();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    host.handle("storage.get", async ({ key }) => {
      if (key === "slow") await gate;
      return key;
    });
    const slow = client.storage.get("slow");
    const fast = client.storage.get("fast");
    await expect(fast).resolves.toBe("fast");
    release();
    await expect(slow).resolves.toBe("slow");
    client.close();
    host.close();
  });

  it("times out one request without breaking the connection", async () => {
    const { host, client } = await connected({}, { requestTimeoutMs: 30 });
    host.handle("config.get", () => new Promise(() => {}));
    await expect(client.config.get()).rejects.toMatchObject({ code: "TIMEOUT" });
    await expect(client.storage.list()).resolves.toEqual([]);
    client.close();
    host.close();
  });

  it("surfaces host errors as CadencrError", async () => {
    const { host, client } = await connected();
    await expect(client.net.fetch("https://example.com")).rejects.toMatchObject({
      name: "CadencrError",
      code: "PLUGIN_NETWORK_DENIED",
    });
    client.close();
    host.close();
  });

  it("round-trips storage, state, config and ui", async () => {
    const { host, client } = await connected({ config: { group: "directory" } });
    await client.storage.set("a", { n: 1 });
    await expect(client.storage.get("a")).resolves.toEqual({ n: 1 });
    await expect(client.storage.get("missing")).resolves.toBeNull();
    await expect(client.storage.list()).resolves.toEqual(["a"]);
    await client.storage.delete("a");
    await expect(client.storage.list()).resolves.toEqual([]);
    await expect(client.state.get()).resolves.toBeNull();
    await client.state.set({ tab: 2 });
    await expect(client.state.get()).resolves.toEqual({ tab: 2 });
    await expect(client.config.get()).resolves.toEqual({ group: "directory" });
    await client.ui.toast({ title: "Saved", variant: "success" });
    await client.ui.setBadge("3");
    expect(host.badge).toBe("3");
    await expect(client.ui.setBadge("12345")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(client.ui.openExternal("http://x.test")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await client.ui.openExternal("https://x.test");
    expect(host.requests.map((r) => r.method)).toContain("ui.openExternal");
    client.close();
    host.close();
  });

  it("encodes net.fetch bodies as ArrayBuffer", async () => {
    const { host, client } = await connected();
    host.handle("net.fetch", ({ body }) => ({
      status: 201,
      headers: { "X-Echo": "1" },
      body: body ?? new ArrayBuffer(0),
    }));
    const response = await client.net.fetch("https://api.test/x", { method: "POST", body: "hi" });
    expect(response.status).toBe(201);
    expect(response.headers["x-echo"]).toBe("1");
    await expect(response.text()).resolves.toBe("hi");
    client.close();
    host.close();
  });
});

describe("events", () => {
  it("tracks context and visibility changes", async () => {
    const { host, client } = await connected();
    const contexts: number[] = [];
    const visibility: boolean[] = [];
    client.onContextChange((context) => contexts.push(context.feature.id));
    client.onVisibilityChange((visible) => visibility.push(visible));
    const next = createTabContext({
      feature: { ...host.context.feature, id: 42 },
    });
    host.setContext(next);
    host.setVisible(false);
    await flush();
    expect(contexts).toEqual([42]);
    expect(client.context.feature.id).toBe(42);
    expect(visibility).toEqual([false]);
    expect(client.visible).toBe(false);
    client.close();
    host.close();
  });
});

describe("theme option", () => {
  it("does not touch the document outside a browser", async () => {
    const spy = vi.fn();
    const { host, client } = await connected();
    client.onThemeChange(spy);
    host.setTheme({ ...host.theme, id: "cadencr-light", appearance: "light" });
    await flush();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: "cadencr-light" }));
    expect(client.theme.appearance).toBe("light");
    client.close();
    host.close();
  });
});
