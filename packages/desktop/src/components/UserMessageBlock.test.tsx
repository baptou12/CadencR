import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UserMessageBlock } from "./UserMessageBlock";

describe("UserMessageBlock", () => {
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
});
