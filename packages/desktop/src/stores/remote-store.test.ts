import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteStatus } from "@/api/generated";

const remoteStatus = vi.fn();

vi.mock("@/api/generated", () => ({
  remoteStatus: (...args: unknown[]) => remoteStatus(...args),
  remoteEnable: vi.fn(),
  remoteDisable: vi.fn(),
  remoteRevokeDevice: vi.fn(),
  remoteSetTunnelHost: vi.fn(),
}));

import { useRemoteStore } from "./remote-store";

function status(): RemoteStatus {
  return {
    enabled: false,
    connected_devices: 0,
    pairing_state: "none",
    devices: [],
    audit_tail: [],
    lan_urls: [],
  } as RemoteStatus;
}

/** A promise plus its resolver, so a test can hold `refresh()` in-flight. */
function deferred(): { promise: Promise<RemoteStatus>; resolve: (value: RemoteStatus) => void } {
  let resolve!: (value: RemoteStatus) => void;
  const promise = new Promise<RemoteStatus>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("remote-store refresh single-flight", () => {
  beforeEach(() => {
    remoteStatus.mockReset();
    useRemoteStore.setState({ status: null, loaded: false, phase: "idle", error: null });
  });

  it("coalesces overlapping refreshes into one request", async () => {
    const gate = deferred();
    remoteStatus.mockReturnValueOnce(gate.promise);

    const first = useRemoteStore.getState().refresh();
    const second = useRemoteStore.getState().refresh();

    expect(remoteStatus).toHaveBeenCalledTimes(1);

    gate.resolve(status());
    await Promise.all([first, second]);

    expect(useRemoteStore.getState().loaded).toBe(true);
  });

  it("fetches again once the in-flight refresh has settled", async () => {
    remoteStatus.mockResolvedValue(status());

    await useRemoteStore.getState().refresh();
    await useRemoteStore.getState().refresh();

    expect(remoteStatus).toHaveBeenCalledTimes(2);
  });
});
