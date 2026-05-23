import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

// LSPPlugin.get is static — we stub it per-test so we don't need a full
// LSPClient instance just to verify the toast path.
type ClientStub = {
  serverCapabilities: { definitionProvider?: boolean | object | null } | null;
  sync: () => void;
  request: (method: string, params: unknown) => Promise<unknown>;
  workspace: { displayFile: (uri: string) => Promise<EditorView | null> };
  withMapping: <T>(f: (mapping: unknown) => Promise<T>) => Promise<T>;
};
type PluginStub = {
  client: ClientStub;
  uri: string;
  toPosition: (offset: number) => { line: number; character: number };
  fromPosition: (pos: { line: number; character: number }) => number;
};

let pluginStub: PluginStub | null = null;
vi.mock("@codemirror/lsp-client", () => ({
  LSPPlugin: { get: () => pluginStub },
}));

import { jumpToDefinitionCommand } from "./definition";

function createView(): EditorView {
  return new EditorView({ state: EditorState.create({ doc: "foo bar baz" }) });
}

function defaultClient(overrides: Partial<ClientStub> = {}): ClientStub {
  return {
    serverCapabilities: { definitionProvider: true },
    sync: () => {},
    request: () => Promise.resolve(null),
    workspace: { displayFile: async () => null },
    withMapping: async (f) => f({ getMapping: () => null, mapPosition: () => 0 }),
    ...overrides,
  };
}

function defaultPlugin(client: ClientStub): PluginStub {
  return {
    client,
    uri: "file:///workspace/src/main.ts",
    toPosition: () => ({ line: 0, character: 0 }),
    fromPosition: () => 0,
  };
}

describe("jumpToDefinitionCommand", () => {
  beforeEach(() => {
    toastError.mockClear();
    pluginStub = null;
  });

  it("returns false when no LSP plugin is attached", () => {
    pluginStub = null;
    const view = createView();
    expect(jumpToDefinitionCommand(view)).toBe(false);
    view.destroy();
  });

  it("returns false when the server has no definition capability", () => {
    pluginStub = defaultPlugin(defaultClient({ serverCapabilities: {} }));
    const view = createView();
    expect(jumpToDefinitionCommand(view)).toBe(false);
    view.destroy();
  });

  it("returns false before the server's initialize response arrives", () => {
    pluginStub = defaultPlugin(defaultClient({ serverCapabilities: null }));
    const view = createView();
    expect(jumpToDefinitionCommand(view)).toBe(false);
    view.destroy();
  });

  it("surfaces request rejections as a toast (not a banner)", async () => {
    pluginStub = defaultPlugin(
      defaultClient({
        request: () => Promise.reject(new Error("Request timed out")),
      }),
    );
    const view = createView();
    expect(jumpToDefinitionCommand(view)).toBe(true);
    // withMapping awaits the inner promise; flush microtasks.
    await new Promise((r) => setTimeout(r, 0));
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith("Go to definition failed: Request timed out");
    view.destroy();
  });

  it("no-ops cleanly when the server returns null", async () => {
    pluginStub = defaultPlugin(defaultClient({ request: () => Promise.resolve(null) }));
    const view = createView();
    expect(jumpToDefinitionCommand(view)).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(toastError).not.toHaveBeenCalled();
    view.destroy();
  });
});
