import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { AgentTodoList } from "./AgentTodoList";
import type { TodoItem } from "@/hooks/useFeatureAgentState";

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
  it("renders task list", () => {
    render(<AgentTodoList todos={[pendingTodo, completedTodo]} />);
    expect(screen.getByText("Tasks")).toBeInTheDocument();
  });

  it("shows completed count", () => {
    render(<AgentTodoList todos={[pendingTodo, completedTodo]} />);
    expect(screen.getByText("1/2 completed")).toBeInTheDocument();
  });

  it("renders all todo items", () => {
    render(<AgentTodoList todos={[pendingTodo, inProgressTodo, completedTodo]} />);
    expect(screen.getByText("Pending task")).toBeInTheDocument();
    // in_progress shows activeForm
    expect(screen.getByText("Working on in progress task")).toBeInTheDocument();
    expect(screen.getByText("Completed task")).toBeInTheDocument();
  });

  it("collapses and expands when header clicked", async () => {
    const user = userEvent.setup();
    render(<AgentTodoList todos={[pendingTodo]} />);
    expect(screen.getByText("Pending task")).toBeInTheDocument();
    await user.click(screen.getByRole("button"));
    expect(screen.queryByText("Pending task")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("Pending task")).toBeInTheDocument();
  });

  it("renders with all completed todos", () => {
    render(<AgentTodoList todos={[completedTodo, completedTodo]} />);
    expect(screen.getByText("2/2 completed")).toBeInTheDocument();
  });

  it("renders pending todo without active form", () => {
    render(<AgentTodoList todos={[pendingTodo]} />);
    expect(screen.getByText("Pending task")).toBeInTheDocument();
    expect(screen.queryByText("Doing pending task")).not.toBeInTheDocument();
  });

  it("uses timer mock without side effects", () => {
    vi.useFakeTimers();
    render(<AgentTodoList todos={[completedTodo]} />);
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    vi.useRealTimers();
  });
});
