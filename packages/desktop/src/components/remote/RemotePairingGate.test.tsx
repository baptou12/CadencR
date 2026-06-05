import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@/test-utils";
import { extractPairingCode, RemotePairingGate } from "./RemotePairingGate";
import * as deviceToken from "@/lib/remote/device-token";

describe("extractPairingCode", () => {
  it("pulls the code from a full pairing URL", () => {
    expect(extractPairingCode("https://192.168.1.5:9876/?code=ABC-123_def")).toBe("ABC-123_def");
  });

  it("ignores a trailing hash route", () => {
    expect(extractPairingCode("https://host:9876/?code=XYZ#/ws-session/x")).toBe("XYZ");
  });

  it("pulls the code from a bare query fragment", () => {
    expect(extractPairingCode("?code=tok123")).toBe("tok123");
  });

  it("treats a bare token as the code and trims it", () => {
    expect(extractPairingCode("  rawTokenValue  ")).toBe("rawTokenValue");
  });

  it("returns null for blank input", () => {
    expect(extractPairingCode("   ")).toBeNull();
  });
});

describe("RemotePairingGate", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders children on the desktop shell / loopback (not a remote browser)", () => {
    vi.spyOn(deviceToken, "isBrowserRemote").mockReturnValue(false);
    render(
      <RemotePairingGate>
        <div>app-content</div>
      </RemotePairingGate>,
    );
    expect(screen.getByText("app-content")).toBeInTheDocument();
  });

  it("renders children when a remote browser is already paired", () => {
    vi.spyOn(deviceToken, "isBrowserRemote").mockReturnValue(true);
    vi.spyOn(deviceToken, "readDeviceToken").mockReturnValue("a-token");
    render(
      <RemotePairingGate>
        <div>app-content</div>
      </RemotePairingGate>,
    );
    expect(screen.getByText("app-content")).toBeInTheDocument();
  });

  it("shows the pairing screen when a remote browser is unpaired", () => {
    vi.spyOn(deviceToken, "isBrowserRemote").mockReturnValue(true);
    vi.spyOn(deviceToken, "readDeviceToken").mockReturnValue(null);
    render(
      <RemotePairingGate>
        <div>app-content</div>
      </RemotePairingGate>,
    );
    expect(screen.getByRole("heading", { name: /pair this device/i })).toBeInTheDocument();
    expect(screen.queryByText("app-content")).not.toBeInTheDocument();
  });
});
