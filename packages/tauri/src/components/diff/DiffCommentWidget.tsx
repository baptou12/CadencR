import { useState } from "react";
import { format } from "date-fns";
import { Pencil, Trash2 } from "lucide-react";
import { parseUTCDateTime } from "@/lib/date-utils";

export interface DiffComment {
  id: number;
  feature_id: number;
  file_path: string;
  line_number: number;
  side: "old" | "new";
  content: string;
  status: "pending" | "sent" | "resolved";
  created_at: string;
}

/**
 * Inline comment form that appears when clicking the "+" button on a diff line.
 */
export function CommentForm({
  onSubmit,
  onClose,
  initialContent = "",
  submitLabel = "Comment",
}: {
  onSubmit: (content: string) => void;
  onClose: () => void;
  initialContent?: string;
  submitLabel?: string;
}) {
  const [content, setContent] = useState(initialContent);

  return (
    <div className="mx-4 my-2 rounded border border-[#6272a4] bg-[#343746] p-3">
      <textarea
        className="w-full resize-y rounded border border-[#6272a4] bg-[#282a36] px-3 py-2 text-sm !text-white placeholder-[#6272a4] focus:border-[#bd93f9] focus:outline-none"
        placeholder="Add a comment..."
        rows={3}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (content.trim()) {
              onSubmit(content.trim());
            }
          }
        }}
        autoFocus
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          className="rounded bg-[#bd93f9] px-3 py-1 text-xs font-medium text-[#282a36] hover:bg-[#caa9fa] disabled:opacity-50"
          disabled={!content.trim()}
          onClick={() => {
            if (content.trim()) {
              onSubmit(content.trim());
            }
          }}
        >
          {submitLabel}
        </button>
        <button
          className="rounded px-3 py-1 text-xs !text-white hover:!text-white"
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Displays an existing comment with edit/delete actions.
 */
export function CommentDisplay({
  comment,
  onEdit,
  onDelete,
}: {
  comment: DiffComment;
  onEdit: (id: number, content: string) => void;
  onDelete: (id: number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing) {
    return (
      <CommentForm
        initialContent={comment.content}
        submitLabel="Update"
        onSubmit={(content) => {
          onEdit(comment.id, content);
          setIsEditing(false);
        }}
        onClose={() => setIsEditing(false)}
      />
    );
  }

  return (
    <div className="mx-4 my-2 rounded border border-[#6272a4] bg-[#343746] p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="flex-1 whitespace-pre-wrap text-sm !text-[#f8f8f2]">{comment.content}</p>
        <div className="flex shrink-0 gap-1">
          <button
            className="rounded p-1 !text-[#8892b0] hover:bg-[#44475a] hover:!text-[#f8f8f2]"
            onClick={() => setIsEditing(true)}
            title="Edit comment"
          >
            <Pencil className="h-3.5 w-3.5" style={{ stroke: "#8892b0" }} />
          </button>
          <button
            className="rounded p-1 !text-[#8892b0] hover:bg-[#44475a] hover:!text-[#ff5555]"
            onClick={() => onDelete(comment.id)}
            title="Delete comment"
          >
            <Trash2 className="h-3.5 w-3.5" style={{ stroke: "#8892b0" }} />
          </button>
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs !text-[#6272a4]">
        <span
          className={
            comment.status === "pending"
              ? "!text-[#ffb86c]"
              : comment.status === "sent"
                ? "!text-[#50fa7b]"
                : "!text-[#6272a4]"
          }
        >
          {comment.status}
        </span>
        <span className="!text-[#8892b0]">
          {format(parseUTCDateTime(comment.created_at), "MMM d, yyyy h:mm a")}
        </span>
      </div>
    </div>
  );
}

/**
 * Widget line renderer: shows existing comments + new comment form for a line.
 */
export function CommentWidgetLine({
  comments,
  onClose,
  onSubmit,
  onEdit,
  onDelete,
}: {
  comments: DiffComment[];
  onClose: () => void;
  onSubmit: (content: string) => void;
  onEdit: (id: number, content: string) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="border-t border-b border-[#6272a4] bg-[#282a36]">
      {comments.map((c) => (
        <CommentDisplay key={c.id} comment={c} onEdit={onEdit} onDelete={onDelete} />
      ))}
      <CommentForm onSubmit={onSubmit} onClose={onClose} />
    </div>
  );
}

/**
 * Extend line renderer: shows existing comments inline (without the new comment form).
 */
export function CommentExtendLine({
  comments,
  onEdit,
  onDelete,
}: {
  comments: DiffComment[];
  onEdit: (id: number, content: string) => void;
  onDelete: (id: number) => void;
}) {
  if (comments.length === 0) return null;

  return (
    <div className="border-t border-[#6272a4] bg-[#282a36]">
      {comments.map((c) => (
        <CommentDisplay key={c.id} comment={c} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  );
}
