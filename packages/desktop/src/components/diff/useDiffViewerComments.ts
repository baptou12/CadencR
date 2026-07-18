import { useCallback, useMemo, useRef, useState } from "react";
import { useDiffData } from "./useDiffData";
import type { CommentSide } from "./PatchDiffView";
import type { DiffComment } from "./DiffCommentWidget";
import type { ActiveWidget, CommentCallbacks, CommentLineData } from "./diff-comment-decorations";

interface ActiveCommentWidget {
  filePath: string;
  lineNumber: number;
  side: CommentSide;
}

export interface DiffViewerComments {
  commentLinesByFile: Map<string, CommentLineData[]>;
  activeCommentWidget: ActiveCommentWidget | null;
  activeWidget: ActiveWidget | null;
  callbacks: CommentCallbacks;
  addComment: (filePath: string, lineNumber: number, side?: CommentSide) => void;
}

type DiffData = ReturnType<typeof useDiffData>;

/** Stable comment callbacks and per-file line grouping for the diff hot path. */
export function useDiffViewerComments(featureId: number, data: DiffData): DiffViewerComments {
  const [activeCommentWidget, setActiveCommentWidget] = useState<ActiveCommentWidget | null>(null);
  const commentLinesByFile = useMemo(() => {
    const map = new Map<string, CommentLineData[]>();
    for (const comment of data.comments as DiffComment[]) {
      const lines = map.get(comment.file_path) ?? [];
      const existing = lines.find((line) => line.lineNumber === comment.line_number);
      if (existing) existing.comments.push(comment);
      else lines.push({ lineNumber: comment.line_number, comments: [comment] });
      map.set(comment.file_path, lines);
    }
    return map;
  }, [data.comments]);
  const stateRef = useRef({ activeCommentWidget, data, featureId });
  stateRef.current = { activeCommentWidget, data, featureId };

  const addComment = useCallback(
    (filePath: string, lineNumber: number, side: CommentSide = "new") =>
      setActiveCommentWidget({ filePath, lineNumber, side }),
    [],
  );
  const activeWidget = useMemo<ActiveWidget | null>(
    () =>
      activeCommentWidget
        ? { lineNumber: activeCommentWidget.lineNumber, side: activeCommentWidget.side }
        : null,
    [activeCommentWidget],
  );
  const callbacks = useMemo<CommentCallbacks>(
    () => ({
      onSubmit: (lineNumber, content) => {
        const current = stateRef.current;
        const active = current.activeCommentWidget;
        if (!active || !content) return;
        current.data.createComment.mutate({
          featureId: current.featureId,
          data: {
            feature_id: current.featureId,
            file_path: active.filePath,
            line_number: lineNumber,
            side: active.side,
            content,
            original_blob_sha: current.data.blobShas[active.filePath] ?? null,
          },
        });
        setActiveCommentWidget(null);
      },
      onClose: () => setActiveCommentWidget(null),
      onEdit: (id, content) =>
        stateRef.current.data.updateComment.mutate({ id, data: { content } }),
      onDelete: (id) => stateRef.current.data.deleteComment.mutate({ id }),
    }),
    [],
  );

  return useMemo(
    () => ({ commentLinesByFile, activeCommentWidget, activeWidget, callbacks, addComment }),
    [activeCommentWidget, activeWidget, addComment, callbacks, commentLinesByFile],
  );
}
