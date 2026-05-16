import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@/test-utils";
import { useState, type ReactNode } from "react";
import { RootErrorBoundary } from "./RootErrorBoundary";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  pathname: "/agents",
  workspaceSettingData: undefined as { value?: string } | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useRouterState: (opts: { select: (s: { location: { pathname: string } }) => string }) =>
    opts.select({ location: { pathname: mocks.pathname } }),
}));

vi.mock("@/api/generated", () => ({
  useGetWorkspaceSetting: () => ({ data: mocks.workspaceSettingData }),
}));

function Boom(): never {
  throw new Error("kaboom");
}

describe("RootErrorBoundary", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.pathname = "/agents";
    mocks.workspaceSettingData = undefined;
  });

  it("renders children when nothing throws", () => {
    render(
      <RootErrorBoundary>
        <span>child content</span>
      </RootErrorBoundary>,
    );
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("shows the recovery fallback and offers an agents-view escape hatch", async () => {
    // Suppress React's noisy error logging from the intentional throw.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { user } = render(
      <RootErrorBoundary>
        <Boom />
      </RootErrorBoundary>,
    );
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/kaboom/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /unified agents view/i }));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/agents" });

    errSpy.mockRestore();
  });

  it("disables the recent-conversation button when nothing is saved", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <RootErrorBoundary>
        <Boom />
      </RootErrorBoundary>,
    );
    expect(screen.getByRole("button", { name: /no recent conversation/i })).toBeDisabled();
    errSpy.mockRestore();
  });

  it("clears the error when the route changes (e.g. sidebar nav)", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Harness({ children }: { children: ReactNode }) {
      const [shouldThrow, setShouldThrow] = useState(true);
      // Expose a manual reset switch so the test can simulate the child no
      // longer throwing once the user navigates somewhere else.
      (globalThis as { __stopThrowing?: () => void }).__stopThrowing = () => setShouldThrow(false);
      return <RootErrorBoundary>{shouldThrow ? <Boom /> : children}</RootErrorBoundary>;
    }
    const { rerender } = render(
      <Harness>
        <span>recovered</span>
      </Harness>,
    );
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();

    // Simulate route change + child no longer throwing.
    act(() => {
      (globalThis as { __stopThrowing?: () => void }).__stopThrowing?.();
      mocks.pathname = "/agents/different";
    });
    rerender(
      <Harness>
        <span>recovered</span>
      </Harness>,
    );
    expect(screen.getByText("recovered")).toBeInTheDocument();
    errSpy.mockRestore();
  });

  it("navigates to the saved most-recent conversation when available", async () => {
    mocks.workspaceSettingData = {
      value: JSON.stringify({ projectId: 7, featureId: 42, activeTab: "agent" }),
    };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { user } = render(
      <RootErrorBoundary>
        <Boom />
      </RootErrorBoundary>,
    );

    await user.click(screen.getByRole("button", { name: /most recent conversation/i }));
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/projects/$projectId/features/$featureId",
      params: { projectId: "7", featureId: "42" },
    });
    errSpy.mockRestore();
  });
});
