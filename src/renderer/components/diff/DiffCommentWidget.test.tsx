import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@/test-utils";
import {
  CommentForm,
  CommentDisplay,
  CommentWidgetLine,
  CommentExtendLine,
  type DiffComment,
} from "./DiffCommentWidget";

const mockComment: DiffComment = {
  id: 1,
  feature_id: 10,
  file_path: "src/foo.ts",
  line_number: 42,
  side: "new",
  content: "This looks wrong",
  status: "pending",
  created_at: "2024-01-15T10:00:00.000Z",
};

describe("CommentForm", () => {
  it("renders the textarea", () => {
    render(<CommentForm onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText("Add a comment...")).toBeInTheDocument();
  });

  it("calls onSubmit with content when submitted", () => {
    const onSubmit = vi.fn();
    render(<CommentForm onSubmit={onSubmit} onClose={vi.fn()} />);
    const textarea = screen.getByPlaceholderText("Add a comment...");
    fireEvent.change(textarea, { target: { value: "My comment" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(onSubmit).toHaveBeenCalledWith("My comment");
  });

  it("calls onClose when cancel is clicked", () => {
    const onClose = vi.fn();
    render(<CommentForm onSubmit={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("submit button is disabled when content is empty", () => {
    render(<CommentForm onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Comment" })).toBeDisabled();
  });

  it("pre-fills initialContent", () => {
    render(
      <CommentForm
        onSubmit={vi.fn()}
        onClose={vi.fn()}
        initialContent="existing note"
        submitLabel="Update"
      />,
    );
    const textarea = screen.getByPlaceholderText("Add a comment...") as HTMLTextAreaElement;
    expect(textarea.value).toBe("existing note");
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
  });
});

describe("CommentDisplay", () => {
  it("renders comment content", () => {
    render(
      <CommentDisplay
        comment={mockComment}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("This looks wrong")).toBeInTheDocument();
  });

  it("shows status badge", () => {
    render(
      <CommentDisplay
        comment={mockComment}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("switches to edit mode when edit button clicked", () => {
    render(
      <CommentDisplay
        comment={mockComment}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle("Edit comment"));
    expect(screen.getByPlaceholderText("Add a comment...")).toBeInTheDocument();
  });

  it("calls onDelete with comment id", () => {
    const onDelete = vi.fn();
    render(
      <CommentDisplay
        comment={mockComment}
        onEdit={vi.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByTitle("Delete comment"));
    expect(onDelete).toHaveBeenCalledWith(1);
  });
});

describe("CommentWidgetLine", () => {
  it("renders existing comments and new form", () => {
    render(
      <CommentWidgetLine
        comments={[mockComment]}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("This looks wrong")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Add a comment...")).toBeInTheDocument();
  });

  it("renders just the form when no comments", () => {
    render(
      <CommentWidgetLine
        comments={[]}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText("Add a comment...")).toBeInTheDocument();
  });
});

describe("CommentExtendLine", () => {
  it("renders nothing when empty", () => {
    const { container } = render(
      <CommentExtendLine comments={[]} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders comments", () => {
    render(
      <CommentExtendLine
        comments={[mockComment]}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("This looks wrong")).toBeInTheDocument();
  });
});
