import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "@testing-library/react";
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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("does not auto-open on initial render", () => {
    render(<AgentTodoList todos={[pendingTodo, completedTodo]} />);
    expect(screen.queryByText("Tasks")).not.toBeInTheDocument();
  });

  it("auto-opens when todos change and auto-closes after 3 seconds", () => {
    vi.useFakeTimers();
    const { rerender } = render(<AgentTodoList todos={[pendingTodo]} />);
    expect(screen.queryByText("Tasks")).not.toBeInTheDocument();

    // A new todos reference triggers the auto-open.
    rerender(<AgentTodoList todos={[pendingTodo, completedTodo]} />);
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Pending task")).toBeInTheDocument();
    expect(screen.getByText("Completed task")).toBeInTheDocument();

    // Still open just before 3s elapses.
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(screen.getByText("Tasks")).toBeInTheDocument();

    // Closes at 3s.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Tasks")).not.toBeInTheDocument();
  });

  it("resets the auto-close timer when todos change again within the window", () => {
    vi.useFakeTimers();
    const { rerender } = render(<AgentTodoList todos={[pendingTodo]} />);

    rerender(<AgentTodoList todos={[pendingTodo, completedTodo]} />);
    expect(screen.getByText("Tasks")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Second change within the window should reset the 3s window.
    rerender(<AgentTodoList todos={[pendingTodo, completedTodo, inProgressTodo]} />);
    expect(screen.getByText("Tasks")).toBeInTheDocument();

    // 2s after the second change — would have closed under original timer, should still be open.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText("Tasks")).toBeInTheDocument();

    // 3s after the second change — now closed.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText("Tasks")).not.toBeInTheDocument();
  });

  it("keeps focus on the current textbox when todos auto-open", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <div>
        <input aria-label="Prompt" />
        <AgentTodoList todos={[pendingTodo]} />
      </div>,
    );
    const input = screen.getByRole("textbox", { name: "Prompt" });
    input.focus();

    rerender(
      <div>
        <input aria-label="Prompt" />
        <AgentTodoList todos={[pendingTodo, completedTodo]} />
      </div>,
    );

    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(document.activeElement).toBe(input);
  });

  it("renders long todo content without truncation classes", async () => {
    const user = userEvent.setup();
    const longTodo: TodoItem = {
      content:
        "A really long task description that would previously have been ellipsized inside the narrow popover",
      activeForm: "Doing a really long task",
      status: "pending",
    };
    render(<AgentTodoList todos={[longTodo]} />);
    await user.click(screen.getByRole("button"));
    const span = screen.getByText(longTodo.content);
    expect(span.className).not.toContain("truncate");
    expect(span.className).not.toContain("whitespace-nowrap");
    expect(span.className).toContain("break-words");
  });
});
