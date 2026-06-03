import { create } from "zustand";
import {
  remoteDisable,
  remoteEnable,
  remoteRevokeDevice,
  remoteSetTunnelHost,
  remoteStatus,
  type RemoteStatus,
} from "@/api/generated";
import { isRemoteStatus } from "@/lib/remote/validate";
import { apiErrorMessage } from "@/lib/api-errors";

/**
 * Host-side remote-access control state. Loopback-only: these endpoints require
 * the launch token and are never reachable from a remote device.
 *
 * No optimistic updates — every action awaits the backend and commits the
 * `RemoteStatus` the endpoint returns (enable/disable/revoke all echo fresh
 * status). `phase` drives spinners (explicit-state rule); `error` is rendered
 * inline by the dialog, which is always open while these actions run.
 */
export type RemotePhase = "idle" | "loading" | "mutating";

interface RemoteState {
  status: RemoteStatus | null;
  /** True once at least one successful fetch has populated `status`. */
  loaded: boolean;
  phase: RemotePhase;
  error: string | null;
  refresh: () => Promise<void>;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  revokeDevice: (id: number) => Promise<void>;
  /** Set (or clear, with `null`) the tunnel hostname; restarts the listener. */
  setTunnelHost: (host: string | null) => Promise<void>;
}

type SetState = (partial: Partial<RemoteState>) => void;

async function runStatusCall(
  set: SetState,
  phase: Exclude<RemotePhase, "idle">,
  call: () => Promise<unknown>,
): Promise<void> {
  set({ phase, error: null });
  try {
    const result = await call();
    if (!isRemoteStatus(result)) throw new Error("Malformed remote status response.");
    set({ status: result, loaded: true, phase: "idle" });
  } catch (err) {
    // `apiErrorMessage` surfaces the backend `{ error }` body (e.g. the dev-only
    // "remote access requires a packaged build" 503) instead of a bare HTTP code.
    set({ phase: "idle", error: apiErrorMessage(err, "Remote access request failed.") });
  }
}

export const useRemoteStore = create<RemoteState>((set) => ({
  status: null,
  loaded: false,
  phase: "idle",
  error: null,
  refresh: () => runStatusCall(set, "loading", () => remoteStatus()),
  enable: () => runStatusCall(set, "mutating", () => remoteEnable()),
  disable: () => runStatusCall(set, "mutating", () => remoteDisable()),
  revokeDevice: (id) => runStatusCall(set, "mutating", () => remoteRevokeDevice(id)),
  setTunnelHost: (host) => runStatusCall(set, "mutating", () => remoteSetTunnelHost({ host })),
}));
