import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildUserMessageContent } from "@/types/agent-types";
import { UserMessageBlock } from "./UserMessageBlock";

const { navigate, useGetFeature } = vi.hoisted(() => ({
  navigate: vi.fn(),
  useGetFeature: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/api/generated", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/generated")>()),
  useGetFeature,
}));

describe("UserMessageBlock", () => {
  beforeEach(() => {
    navigate.mockReset();
    useGetFeature.mockReturnValue({ data: undefined, isError: false, isLoading: false });
  });

  it("uses provider-neutral copy for pending receipt state", () => {
    render(<UserMessageBlock content="steer now" deliveryState="pending_agent" />);

    expect(screen.getByText("Not received by agent yet…")).toBeInTheDocument();
    expect(screen.queryByText(/OpenCode/)).toBeNull();
  });

  it("visually distinguishes pending prompt delivery", () => {
    render(<UserMessageBlock content="steer now" deliveryState="pending_agent" />);

    const bubble = screen.getByTestId("user-message-bubble");
    expect(bubble).toHaveAttribute("data-prompt-delivery-state", "pending_agent");
    expect(bubble).toHaveClass("border-amber-500/50", "bg-amber-500/10");
    expect(screen.getByText("Not received by agent yet…")).toHaveClass("text-amber-300");
  });

  it("renders the resolved source feature title as a clickable conversation link", async () => {
    const user = userEvent.setup();
    useGetFeature.mockReturnValue({
      data: { id: 45, project_id: 6, title: "Investigate flaky tests" },
      isError: false,
      isLoading: false,
    });
    render(
      <UserMessageBlock
        content="please investigate"
        origin={{
          originKind: "session_generated",
          sourceSessionId: 123,
          sourceFeatureId: 45,
          sourceProjectId: 6,
          sourceMessageId: 789,
          note: "spawned helper",
          createdAt: "2026-06-18T12:00:00Z",
        }}
      />,
    );

    expect(screen.getByText("Sent by")).toBeInTheDocument();
    const title = screen.getByRole("button", {
      name: "Open conversation Investigate flaky tests",
    });
    expect(title).toHaveTextContent("“Investigate flaky tests”");
    expect(screen.queryByText(/Feature 45/)).toBeNull();

    await user.click(title);
    expect(navigate).toHaveBeenCalledWith({
      to: "/projects/$projectId/features/$featureId",
      params: { projectId: "6", featureId: "45" },
    });
  });

  it("renders a non-clickable session fallback when the feature title is unavailable", () => {
    render(
      <UserMessageBlock
        content="please investigate"
        origin={{
          originKind: "session_generated",
          sourceSessionId: 123,
          sourceFeatureId: 45,
          sourceProjectId: 6,
          sourceMessageId: 789,
          createdAt: "2026-06-18T12:00:00Z",
        }}
      />,
    );

    expect(screen.getByText("Session 123")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders non-image attachment filenames instead of image previews", () => {
    const content = buildUserMessageContent("review this", [
      {
        base64: "JVBERi0x",
        fileName: "requirements.pdf",
        kind: "document",
        mimeType: "application/pdf",
      },
    ]);

    render(<UserMessageBlock content={content} />);

    expect(screen.getByText("requirements.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
