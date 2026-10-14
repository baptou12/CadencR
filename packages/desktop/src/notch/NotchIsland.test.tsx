import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotchAgent, NotchBridge, NotchNotification, NotchPrefs } from "@/shared/notch";
import { NotchIsland } from "./NotchIsland";

function agent(featureId: number, status: NotchAgent["status"]): NotchAgent {
  return {
    featureId,
    projectId: 1,
    title: `Agent ${featureId}`,
    projectName: "cadencr",
    status,
    pendingKind: status === "question" ? "permission" : null,
    providerLabel: null,
    providerIconSrc: null,
    providerIconMono: false,
    turnStartedAtMs: null,
    lastActivityAtMs: null,
    lastAction: null,
    preview: null,
    unread: false,
  };
}

interface BridgeHandles {
  bridge: NotchBridge;
  notify: (notification: NotchNotification) => void;
  hover: (hovering: boolean) => void;
  snoozed: (until: number | null) => void;
}

function installBridge(prefs: NotchPrefs, snoozedUntil: number | null = null): BridgeHandles {
  const off = () => () => {};
  let notify: (notification: NotchNotification) => void = () => {};
  let hover: (hovering: boolean) => void = () => {};
  let snoozed: (until: number | null) => void = () => {};
  const bridge: NotchBridge = {
    ready: () =>
      Promise.resolve({
        geometry: {
          notchWidth: 200,
          notchHeight: 32,
          hardware: true,
          windowWidth: 720,
          windowHeight: 620,
        },
        snapshot: { agents: [agent(1, "question"), agent(2, "running")] },
        prefs,
        snoozedUntil,
      }),
    setHotRect: vi.fn(() => Promise.resolve()),
    openFeature: vi.fn(() => Promise.resolve()),
    dismiss: vi.fn(() => Promise.resolve()),
    collapse: vi.fn(() => Promise.resolve()),
    snooze: vi.fn(() => Promise.resolve()),
    onSnapshot: off,
    onNotification: (cb) => {
      notify = cb;
      return () => {};
    },
    onHover: (cb) => {
      hover = cb;
      return () => {};
    },
    onGeometry: off,
    onPrefs: off,
    onSnooze: (cb) => {
      snoozed = cb;
      return () => {};
    },
  };
  window.cadencrNotch = bridge;
  return {
    bridge,
    notify: (n) => notify(n),
    hover: (h) => hover(h),
    snoozed: (until) => snoozed(until),
  };
}

async function renderCompactLayer(prefs: NotchPrefs): Promise<HTMLElement> {
  installBridge(prefs);
  const { container } = render(<NotchIsland />);
  await waitFor(() =>
    expect(container.querySelector('.island[data-mode="compact"]')).not.toBeNull(),
  );
  const layer = container.querySelector<HTMLElement>('.layer[data-active="true"]');
  if (!layer) throw new Error("No active layer");
  return layer;
}

afterEach(() => {
  delete window.cadencrNotch;
  vi.useRealTimers();
});

describe("NotchIsland compact ears", () => {
  it("shows the plain logo and still status dots with Always animate off", async () => {
    const layer = await renderCompactLayer({ alwaysOn: true, alwaysAnimate: false });

    expect(layer.querySelector(".orb")?.getAttribute("data-state")).toBe("logo");
    expect(layer.querySelector(".compact-dots")?.getAttribute("data-still")).toBe("true");
    expect(
      [...layer.querySelectorAll(".compact-dot")].map((dot) => dot.getAttribute("data-status")),
    ).toEqual(["question", "running"]);
  });

  it("shows the aggregate status orb with Always animate on", async () => {
    const layer = await renderCompactLayer({ alwaysOn: true, alwaysAnimate: true });

    expect(layer.querySelector(".orb")?.getAttribute("data-state")).toBe("question");
    expect(layer.querySelector(".compact-dots")?.getAttribute("data-still")).toBe("false");
  });
});

describe("NotchIsland snooze and close", () => {
  const ALWAYS_ON: NotchPrefs = { alwaysOn: true, alwaysAnimate: false };
  const mode = (container: HTMLElement) =>
    container.querySelector(".island")?.getAttribute("data-mode");

  it("tucks the compact ears away while snoozed, and brings them back once it ends", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installBridge(ALWAYS_ON, Date.now() + 60_000);
    const { container } = render(<NotchIsland />);
    await waitFor(() => expect(mode(container)).toBe("idle"));

    act(() => vi.advanceTimersByTime(60_000));

    expect(mode(container)).toBe("compact");
  });

  /** A notification peeking out, with the pointer resting on it. */
  async function heldPeek(): Promise<BridgeHandles & { container: HTMLElement }> {
    const handles = installBridge(ALWAYS_ON);
    const { container } = render(<NotchIsland />);
    await waitFor(() => expect(mode(container)).toBe("compact"));
    act(() =>
      handles.notify({
        id: "n1",
        featureId: 1,
        projectId: 1,
        status: "completed",
        title: "Agent finished",
        body: "",
      }),
    );
    act(() => handles.hover(true));
    await screen.findByRole("button", { name: "Close" });
    return { ...handles, container };
  }

  it("closes a held peek without opening its conversation", async () => {
    const { bridge } = await heldPeek();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(bridge.collapse).toHaveBeenCalled();
    expect(bridge.openFeature).not.toHaveBeenCalled();
    expect(screen.queryByText("Agent finished")).toBeNull();
  });

  it("opens the conversation from the rest of the peek", async () => {
    const { bridge } = await heldPeek();

    fireEvent.click(screen.getByRole("button", { name: "Open Agent finished" }));

    expect(bridge.openFeature).toHaveBeenCalledWith({ featureId: 1, projectId: 1 });
  });

  it("snoozes from a held peek, which main's snooze push then drops", async () => {
    const { bridge, snoozed, container } = await heldPeek();

    fireEvent.click(screen.getByRole("button", { name: "30m" }));
    expect(bridge.snooze).toHaveBeenCalledWith(30);
    expect(bridge.openFeature).not.toHaveBeenCalled();

    act(() => {
      snoozed(Date.now() + 30 * 60_000);
    });
    expect(screen.queryByText("Agent finished")).toBeNull();
    expect(mode(container)).not.toBe("compact");
  });
});
