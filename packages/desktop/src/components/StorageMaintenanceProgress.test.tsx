import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@/test-utils";
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
