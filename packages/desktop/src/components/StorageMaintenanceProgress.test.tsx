import { afterEach, describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, within } from "@/test-utils";
import {
  applyStorageMaintenanceEvent,
  clearStorageMaintenanceStatus,
} from "@/stores/storage-maintenance-store";
import { StorageMaintenanceProgress } from "./StorageMaintenanceProgress";

describe("StorageMaintenanceProgress", () => {
  afterEach(() => clearStorageMaintenanceStatus());

  it("renders first-run optimization progress", () => {
    applyStorageMaintenanceEvent({
      phase: "progress",
      task: "optimization",
      completed: 25,
      total: 100,
    });
    render(<StorageMaintenanceProgress />);

    expect(screen.getByText("Optimizing storage")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Optimizing storage" })).toHaveAttribute(
      "aria-valuenow",
      "25",
    );
  });

  it("renders later archived-conversation cleanup progress", () => {
    applyStorageMaintenanceEvent({
      phase: "progress",
      task: "cleanup",
      completed: 3,
      total: 8,
    });
    render(<StorageMaintenanceProgress />);

    expect(screen.getByText("Cleaning archived conversations")).toBeInTheDocument();
    expect(screen.getByText("38%")).toBeInTheDocument();
  });

  it("explains background cleanup clearly on hover", async () => {
    const user = userEvent.setup();
    applyStorageMaintenanceEvent({
      phase: "progress",
      task: "cleanup",
      completed: 3,
      total: 8,
    });
    render(<StorageMaintenanceProgress />);

    await user.hover(screen.getByRole("status"));

    const explanation = await screen.findByRole("tooltip");
    expect(explanation).toHaveTextContent("Processed 3 of 8 archived conversations");
    expect(
      within(explanation).getByText("You can keep using Cadencr normally while cleanup runs."),
    ).toHaveProperty("tagName", "STRONG");
    expect(
      within(explanation).getByText("No conversations or messages are deleted."),
    ).toHaveProperty("tagName", "STRONG");
    expect(explanation).toHaveTextContent("Your messages and agent replies stay available");
    expect(explanation).toHaveTextContent("Cleanup is safe and resumable");
    expect(explanation.textContent).not.toContain(String.fromCodePoint(0x2014));
  });

  it("explains the lossless optimization separately", async () => {
    const user = userEvent.setup();
    applyStorageMaintenanceEvent({
      phase: "progress",
      task: "optimization",
      completed: 25,
      total: 100,
    });
    render(<StorageMaintenanceProgress />);

    await user.hover(screen.getByRole("status"));

    const explanation = await screen.findByRole("tooltip");
    expect(explanation).toHaveTextContent("Storage optimization");
    expect(
      within(explanation).getByText("You can keep using Cadencr normally while optimization runs."),
    ).toHaveProperty("tagName", "STRONG");
    expect(explanation).toHaveTextContent("verified duplicate command output");
    expect(within(explanation).getByText("No conversation information is lost.")).toHaveProperty(
      "tagName",
      "STRONG",
    );
  });

  it("keeps backend failures visible in the sidebar", () => {
    applyStorageMaintenanceEvent({
      phase: "failed",
      task: "cleanup",
      completed: 2,
      total: 8,
    });
    render(<StorageMaintenanceProgress />);

    expect(screen.getByText("Conversation cleanup will retry")).toBeInTheDocument();
  });
});
