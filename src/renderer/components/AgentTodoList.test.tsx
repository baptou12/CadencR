import { describe, it, expect } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { AgentTodoList } from "./AgentTodoList";
import type { TodoItem } from "@/types/agent";

const pendingTodo: TodoItem = {
  content: "Pending task",
  activeForm: "Doing pending task",
  status: "pending",
};

const inProgressTodo: TodoItem = {
  content: "In progress task",
  activeForm: "Working on in progress task",
  status: "in_progress",
};

const completedTodo: TodoItem = {
  content: "Completed task",
  activeForm: "Completing task",
  status: "completed",
};

describe("AgentTodoList", () => {
  it("renders compact counter pill", () => {
    render(<AgentTodoList todos={[pendingTodo, completedTodo]} />);
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });

  it("shows all completed count", () => {
    render(<AgentTodoList todos={[completedTodo, completedTodo]} />);
    expect(screen.getByText("2/2")).toBeInTheDocument();
  });

  it("shows todo items in popover when clicked", async () => {
    const user = userEvent.setup();
    render(<AgentTodoList todos={[pendingTodo, inProgressTodo, completedTodo]} />);
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Pending task")).toBeInTheDocument();
    expect(screen.getByText("Working on in progress task")).toBeInTheDocument();
    expect(screen.getByText("Completed task")).toBeInTheDocument();
  });

  it("renders pending todo without active form", async () => {
    const user = userEvent.setup();
    render(<AgentTodoList todos={[pendingTodo]} />);
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("Pending task")).toBeInTheDocument();
    expect(screen.queryByText("Doing pending task")).not.toBeInTheDocument();
  });

  it("accepts chipClass prop", () => {
    render(<AgentTodoList todos={[completedTodo]} chipClass="custom-chip" />);
    expect(screen.getByRole("button").className).toContain("custom-chip");
  });
});
