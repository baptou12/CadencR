import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@/test-utils";
import { UnifiedAgentsShortcut } from "@/components/UnifiedAgentsShortcut";

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

function fireShortcut(key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    code: `Key${key.toUpperCase()}`,
    metaKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

describe("UnifiedAgentsShortcut", () => {
  beforeEach((): void => {
    navigateMock.mockReset();
  });

  it("keeps Cmd+Shift+R as the global shortcut to open unified agents", () => {
    render(<UnifiedAgentsShortcut />);

    const event = fireShortcut("r");

    expect(event.defaultPrevented).toBe(true);
    expect(navigateMock).toHaveBeenCalledWith({ to: "/agents" });
  });

  it("does not handle Cmd+Shift+F globally", () => {
    render(<UnifiedAgentsShortcut />);

    const event = fireShortcut("f");

    expect(event.defaultPrevented).toBe(false);
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
