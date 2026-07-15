import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AgentStreamItem } from "./AgentStreamItem";

vi.mock("../AgentBlock", () => ({
  AgentBlock: () => <div>Rendered reply</div>,
}));

vi.mock("./AgentStreamContextMenu", () => ({
  default: ({
    branchingEnabled,
    children,
    copyContent,
  }: {
    branchingEnabled?: boolean;
    children: ReactNode;
    copyContent?: string;
  }) => (
    <div
      data-testid="stream-context-menu"
      data-branching-enabled={String(branchingEnabled)}
      data-copy-content={copyContent}
    >
      {children}
    </div>
  ),
}));

describe("AgentStreamItem", () => {
  it("keeps rich copy around generated reply rows while hiding branch actions", () => {
    render(
      <AgentStreamItem
        block={{
          id: "reply-1",
          type: "user_message",
          content:
            '<cadencr-reply from-session="3291" from-feature="1780" status="completed" link="spawned">Visible reply body</cadencr-reply>',
          origin: {
            originKind: "session_generated",
            sourceSessionId: 3291,
            sourceFeatureId: 1780,
          },
        }}
        toolResultMap={new Map()}
      />,
    );

    const menu = screen.getByTestId("stream-context-menu");
    expect(menu).toHaveAttribute("data-copy-content", "Visible reply body");
    expect(menu).toHaveAttribute("data-branching-enabled", "false");
  });
});
