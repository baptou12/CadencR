import { describe, it, expect } from "vitest";
import { render, screen } from "@/test-utils";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "./resizable";

describe("Resizable", () => {
  it("renders panels with content", () => {
    render(
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel defaultSize={50}>Left panel</ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={50}>Right panel</ResizablePanel>
      </ResizablePanelGroup>
    );
    expect(screen.getByText("Left panel")).toBeInTheDocument();
    expect(screen.getByText("Right panel")).toBeInTheDocument();
  });

  it("renders handle with grip icon when withHandle is true", () => {
    const { container } = render(
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel defaultSize={50}>Left</ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50}>Right</ResizablePanel>
      </ResizablePanelGroup>
    );
    expect(container.querySelector("[data-slot='resizable-handle']")).toBeInTheDocument();
  });

  it("renders panel group with data-slot", () => {
    const { container } = render(
      <ResizablePanelGroup direction="vertical">
        <ResizablePanel defaultSize={100}>Content</ResizablePanel>
      </ResizablePanelGroup>
    );
    expect(container.querySelector("[data-slot='resizable-panel-group']")).toBeInTheDocument();
  });
});
